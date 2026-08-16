import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * The M4 exit criterion, mechanically: "a first-time user builds a
 * walkable two-room map with a talking NPC ... unaided" (CLAUDE.md). This
 * automates every step a person would take — paint two rooms connected by
 * a doorway, place a player start and an NPC, write the NPC's line, open
 * the live preview, walk through the doorway, talk to the NPC — and
 * proves each one actually works, in a real browser, through the real UI.
 *
 * What this does *not* and cannot prove: the "10 minutes, unaided, by 5
 * real people" part of the exit criterion. That's a human-usability
 * measurement, not a mechanical one — out of scope for an automated
 * script, and said so plainly rather than silently claimed.
 */

const TILE_SIZE = 32;
const WALL_X = 10;
const DOORWAY_Y = 7;
// Deliberately not near the grid's top-left corner: the floating tool
// toolbar is anchored there (SceneCanvas.css .fg-scene-canvas__controls),
// and it's a real, visible, opaque panel sitting on top of a slice of the
// canvas — same as the tool palette in any layered editor (Figma,
// Photoshop). A real person reaches tiles under it by panning; this test
// reaches around it by choosing a target tile that was never under it,
// confirmed against the toolbar's actual bounding box during debugging.
const PLAYER_START = { x: 3, y: 11 };
const NPC_TILE = { x: 16, y: 7 };
const DIALOGUE = { speaker: "Shopkeeper", text: "Welcome to my shop!" };

interface DebugTransform {
  x: number;
  y: number;
}

function tileWorldCenter(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX * TILE_SIZE + TILE_SIZE / 2, y: tileY * TILE_SIZE + TILE_SIZE / 2 };
}

async function screenPointForTile(page: Page, tileX: number, tileY: number): Promise<{ x: number; y: number }> {
  const canvas = page.locator(".fg-scene-canvas__surface");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("SceneCanvas surface has no bounding box");
  const world = tileWorldCenter(tileX, tileY);
  const screen = await page.evaluate(
    ([wx, wy]: [number, number]) => {
      const debug = (window as unknown as { __forgeSceneCanvasDebug: { camera: { worldToScreen(x: number, y: number): { x: number; y: number } } } })
        .__forgeSceneCanvasDebug;
      return debug.camera.worldToScreen(wx, wy);
    },
    [world.x, world.y] as [number, number],
  );
  return { x: box.x + screen.x, y: box.y + screen.y };
}

// Paints a vertical run of tiles by dragging from yStart to yEnd (either
// direction). The floating tool toolbar/palette sits on top of a slice of
// the canvas (SceneCanvas.css .fg-scene-canvas__controls), but only the
// *first* point matters for that: pointerdown there calls
// setPointerCapture, and a captured element keeps receiving pointermove
// regardless of what's visually on top of it afterward. So the one thing
// callers must get right is starting the drag on a row that isn't covered
// by the panel — same as a real person starting their drag stroke from
// open canvas rather than from on top of the toolbar.
async function dragPaintColumn(page: Page, tileX: number, yStart: number, yEnd: number): Promise<void> {
  const start = await screenPointForTile(page, tileX, yStart);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const step = yEnd >= yStart ? 1 : -1;
  for (let y = yStart; y !== yEnd + step; y += step) {
    const point = await screenPointForTile(page, tileX, y);
    await page.mouse.move(point.x, point.y, { steps: 2 });
  }
  await page.mouse.up();
}

async function clickTile(page: Page, tileX: number, tileY: number): Promise<void> {
  const point = await screenPointForTile(page, tileX, tileY);
  await page.mouse.click(point.x, point.y);
}

function getPreviewFrame(page: Page): Frame {
  const frame = page.frames().find((candidate) => candidate.url().includes("preview.html"));
  if (!frame) throw new Error("preview iframe not found among page.frames()");
  return frame;
}

interface PreviewDebugWindow {
  __forgePreviewDebug?: {
    gameWorld: {
      playerEntity: number | undefined;
      world: { get(id: number, component: string): DebugTransform | undefined };
    } | null;
  };
}

async function readPlayerTransform(previewFrame: Frame): Promise<DebugTransform | null> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug?.gameWorld;
    if (gameWorld?.playerEntity === undefined) return null;
    const transform = gameWorld.world.get(gameWorld.playerEntity, "Transform");
    return transform ? { x: transform.x, y: transform.y } : null;
  });
}

async function waitForPlayerXAtLeast(previewFrame: Frame, threshold: number, timeout: number): Promise<void> {
  await previewFrame.waitForFunction(
    (min: number) => {
      const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug?.gameWorld;
      if (gameWorld?.playerEntity === undefined) return false;
      const transform = gameWorld.world.get(gameWorld.playerEntity, "Transform");
      return transform !== undefined && transform.x >= min;
    },
    threshold,
    { timeout, polling: 100 },
  );
}

async function waitForPlayerYAtLeast(previewFrame: Frame, threshold: number, timeout: number): Promise<void> {
  await previewFrame.waitForFunction(
    (min: number) => {
      const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug?.gameWorld;
      if (gameWorld?.playerEntity === undefined) return false;
      const transform = gameWorld.world.get(gameWorld.playerEntity, "Transform");
      return transform !== undefined && transform.y >= min;
    },
    threshold,
    { timeout, polling: 100 },
  );
}

async function waitForPlayerYAtMost(previewFrame: Frame, threshold: number, timeout: number): Promise<void> {
  await previewFrame.waitForFunction(
    (max: number) => {
      const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug?.gameWorld;
      if (gameWorld?.playerEntity === undefined) return false;
      const transform = gameWorld.world.get(gameWorld.playerEntity, "Transform");
      return transform !== undefined && transform.y <= max;
    },
    threshold,
    { timeout, polling: 100 },
  );
}

test.describe("M4 exit criterion: walkable two-room map with a talking NPC", () => {
  test("paint two rooms, place a player and an NPC, walk through the doorway, and talk to the NPC", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto("/");

    // 1. Create the one scene this map lives in.
    await page.getByRole("button", { name: "Create a scene" }).click();
    await expect(page.getByRole("treeitem", { name: "Scene 1" })).toBeVisible();

    // 2. Paint a wall column with a doorway gap — two rooms, one passage.
    await page.getByRole("radio", { name: "Wall" }).waitFor({ state: "visible" });
    await page.getByRole("radio", { name: "Wall" }).click();
    await dragPaintColumn(page, WALL_X, 0, DOORWAY_Y - 1);
    // Painted bottom-to-top: row 14 is clear of the floating toolbar/
    // palette, row 8 is not — see dragPaintColumn's doc comment.
    await dragPaintColumn(page, WALL_X, 14, DOORWAY_Y + 1);

    // 3. Place the player start and the NPC.
    await page.getByRole("radio", { name: "Player start" }).click();
    await clickTile(page, PLAYER_START.x, PLAYER_START.y);

    await page.getByRole("radio", { name: "NPC" }).click();
    await clickTile(page, NPC_TILE.x, NPC_TILE.y);

    // 4. Placing the NPC auto-selected it — write its one line.
    const speakerField = page.getByLabel("Speaker");
    await expect(speakerField).toBeVisible();
    await speakerField.fill(DIALOGUE.speaker);
    const lineField = page.getByLabel("Line");
    await lineField.fill(DIALOGUE.text);
    await lineField.blur();

    // 5. Open the preview and wait for it to actually be running.
    await expect(page.locator(".fg-preview-panel__overlay")).toHaveCount(0, { timeout: 15_000 });
    const previewFrame = getPreviewFrame(page);
    const previewSurface = previewFrame.locator(".fg-preview-app__surface");
    await previewSurface.waitFor({ state: "visible" });
    await previewSurface.click(); // focus this frame so keyboard input reaches it

    // The first forge:preview:scene message (which spawns the player) is
    // an async postMessage round trip after "ready" — give it a moment.
    await previewFrame.waitForFunction(
      () => (window as unknown as PreviewDebugWindow).__forgePreviewDebug?.gameWorld?.playerEntity !== undefined,
      undefined,
      { timeout: 5_000, polling: 100 },
    );
    const startTransform = await readPlayerTransform(previewFrame);
    expect(startTransform).not.toBeNull();
    const wallBoundaryX = WALL_X * TILE_SIZE;

    // 6. Walk right, toward the wall (no doorway on this row) — collision
    // should stop the player at the wall, not let them pass through it.
    await page.keyboard.down("ArrowRight");
    await waitForPlayerXAtLeast(previewFrame, wallBoundaryX - TILE_SIZE, 8_000);
    await page.waitForTimeout(500); // give it a moment to genuinely stop, not just cross the threshold mid-stride
    await page.keyboard.up("ArrowRight");
    const atWallTransform = await readPlayerTransform(previewFrame);
    expect(atWallTransform!.x).toBeLessThan(wallBoundaryX);

    // 7. Navigate up to the doorway row (the player starts below it, in
    // the lower part of room one, clear of the floating tool toolbar
    // that's anchored over the canvas's top-left corner). Threshold is a
    // few px past the doorway's own center, not just "inside the row": the
    // interact range (gameWorld.ts's INTERACT_RANGE, 40 world units) is
    // tight enough that a whole tile's worth of slack here would leave the
    // player just outside it once travelling horizontally too.
    const doorwayWorld = tileWorldCenter(WALL_X, DOORWAY_Y);
    await page.keyboard.down("ArrowUp");
    await waitForPlayerYAtMost(previewFrame, doorwayWorld.y + 8, 8_000);
    await page.keyboard.up("ArrowUp");

    // 8. Cross through the doorway into room two, up to the NPC.
    const npcWorld = tileWorldCenter(NPC_TILE.x, NPC_TILE.y);
    await page.keyboard.down("ArrowRight");
    await waitForPlayerXAtLeast(previewFrame, npcWorld.x - 20, 10_000);
    await page.keyboard.up("ArrowRight");

    // 9. Interact — the NPC's real, configured dialogue line should appear.
    await page.keyboard.press("e");
    const bubble = previewFrame.locator(".fg-preview-app__dialogue");
    await expect(bubble).toBeVisible({ timeout: 5_000 });
    await expect(bubble.locator(".fg-preview-app__dialogue-speaker")).toHaveText(DIALOGUE.speaker);
    await expect(bubble.locator(".fg-preview-app__dialogue-text")).toHaveText(DIALOGUE.text);

    expect(consoleErrors).toEqual([]);
  });
});
