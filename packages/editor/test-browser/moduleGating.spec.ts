import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * Issue #123's own exit bar, in a real browser: before this fix, the live
 * preview ran `@forge/dialogue` unconditionally, ignoring
 * `ProjectDocument.installedModules` entirely — a creator could author an
 * NPC's dialogue, see it work in preview, uninstall the module (or start
 * from an older/hand-edited document that never had it installed), and
 * get a silently broken interaction on export instead of a build that
 * doesn't talk. This proves the two sides now agree: uninstalling
 * `@forge/dialogue` from the Modules panel takes real, immediate effect in
 * the *already-running* live preview — interact finds nothing to say —
 * the same real state `toExportProjectInput.test.ts` proves the export
 * path now refuses to silently drop.
 */

const TILE_SIZE = 32;
const PLAYER_START = { x: 5, y: 8 };
const NPC_TILE = { x: 6, y: 8 }; // one tile east — well within INTERACT_RANGE (40 world units)
const DIALOGUE = { speaker: "Shopkeeper", text: "Welcome to my shop!" };

function tileWorldCenter(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX * TILE_SIZE + TILE_SIZE / 2, y: tileY * TILE_SIZE + TILE_SIZE / 2 };
}

async function screenPointForTile(page: Page, tileX: number, tileY: number): Promise<{ x: number; y: number }> {
  const canvas = page.locator(".fg-scene-canvas__surface");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("SceneCanvas surface has no bounding box");
  const world = tileWorldCenter(tileX, tileY);
  const screen = await page.evaluate(
    ([wx, wy]) => {
      const debug = (window as unknown as { __forgeSceneCanvasDebug: { camera: { worldToScreen(x: number, y: number): { x: number; y: number } } } })
        .__forgeSceneCanvasDebug;
      return debug.camera.worldToScreen(wx, wy);
    },
    [world.x, world.y] as [number, number],
  );
  return { x: box.x + screen.x, y: box.y + screen.y };
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
    gameWorld: { playerEntity: number | undefined } | null;
  };
}

test.describe("issue #123: preview honors ProjectDocument.installedModules, matching export", () => {
  test("uninstalling @forge/dialogue removes dialogue capability from the already-running live preview", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto("/");
    await page.getByRole("button", { name: "Create a scene" }).click();
    await expect(page.getByRole("treeitem", { name: "Scene 1" })).toBeVisible();

    await page.getByRole("radio", { name: "Player start" }).waitFor({ state: "visible" });
    await page.getByRole("radio", { name: "Player start" }).click();
    await clickTile(page, PLAYER_START.x, PLAYER_START.y);

    await page.getByRole("radio", { name: "NPC" }).click();
    await clickTile(page, NPC_TILE.x, NPC_TILE.y);

    const speakerField = page.getByLabel("Speaker");
    await expect(speakerField).toBeVisible();
    await speakerField.fill(DIALOGUE.speaker);
    const lineField = page.getByLabel("Line");
    await lineField.fill(DIALOGUE.text);
    await lineField.blur();

    // Preview boots with the dialogue module genuinely installed (a
    // brand-new project's own default — DEFAULT_INSTALLED_MODULES,
    // documentTypes.ts) and dialogue actually works, proving this isn't a
    // preview that never ran dialogue at all.
    await expect(page.locator(".fg-preview-panel__overlay")).toHaveCount(0, { timeout: 15_000 });
    const previewFrame = getPreviewFrame(page);
    const previewSurface = previewFrame.locator(".fg-preview-app__surface");
    await previewSurface.waitFor({ state: "visible" });
    await previewSurface.click();
    await previewFrame.waitForFunction(
      () => (window as unknown as PreviewDebugWindow).__forgePreviewDebug?.gameWorld?.playerEntity !== undefined,
      undefined,
      { timeout: 5_000, polling: 100 },
    );

    await page.keyboard.press("e");
    const bubble = previewFrame.locator(".fg-preview-app__dialogue");
    await expect(bubble).toBeVisible({ timeout: 5_000 });
    await expect(bubble.locator(".fg-preview-app__dialogue-speaker")).toHaveText(DIALOGUE.speaker);

    // Now uninstall @forge/dialogue from the Modules panel — a real,
    // undoable project-document operation (projectStore's uninstallModule),
    // the same one a creator would actually click.
    const modulesRegion = page.getByRole("region", { name: "Modules" });
    const dialogueRow = modulesRegion.locator(".fg-modules-list__row").filter({ hasText: "@forge/dialogue" });
    await dialogueRow.getByRole("button", { name: "Uninstall" }).click();

    // The already-running preview (no reload) picks this up on its next
    // real forge:preview:scene message — the same live-update cadence
    // painted tiles already get. No reliable "installedModules changed"
    // signal to poll for directly (it's not on the DEV debug hook), so
    // this is a fixed settle delay after a real document mutation.
    await page.waitForTimeout(500);

    await page.keyboard.press("e");
    // Give any (incorrect) bubble a moment to appear before asserting its
    // absence — asserting immediately would pass even if the fix regressed
    // and the bubble just hadn't rendered yet.
    await page.waitForTimeout(300);
    await expect(bubble).not.toBeVisible();

    expect(consoleErrors).toEqual([]);
  });
});
