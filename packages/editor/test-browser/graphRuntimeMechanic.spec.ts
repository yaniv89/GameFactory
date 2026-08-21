import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * docs/adr/0017's own M6 exit criterion, proven for real rather than
 * asserted: a mechanic built *entirely* through the graph editor UI —
 * no hand-written code, no direct store mutation — actually runs inside
 * the live preview and changes something a player can see. The mechanic
 * itself ("picking up a coin fully heals the player") is new: nothing in
 * the hand-coded vertical slice (H1/I1) currently heals the player at
 * all, so this genuinely could not have been demonstrated any other way
 * before `@forge/graph-runtime`'s live-preview wiring (M5/M6) existed.
 *
 * The graph: core:onEvent(pickup:collected) -> core:setComponent(Health),
 * with the healed value assembled from core:getField (pull the player id
 * off the trigger's own payload) and core:constant + core:setField (wrap
 * a literal 100 into a {current: 100} patch core:setComponent's merge
 * semantics apply on top of the player's existing Health). Every node
 * type here is used exactly once — deliberately, so every palette/
 * outline/connect-picker button has a globally unique accessible name
 * and this spec never needs a fragile `.nth()` index to disambiguate.
 */

const TILE_SIZE = 32;
const PLAYER_START = { x: 12, y: 8 }; // one tile west of DEMO_ENEMY_TILE — see meleeAttack.spec.ts's own comment
const MELEE_REACH = 24; // must match PreviewApp.tsx's own MELEE_REACH

interface PreviewDebugWindow {
  __forgePreviewDebug?: {
    gameWorld: {
      playerEntity: number | undefined;
      enemyEntity: number;
      world: {
        get(id: number, component: string): Record<string, number> | undefined;
        set(id: number, component: string, value: Record<string, number>): void;
        flush(): void;
        isAlive(id: number): boolean;
      };
    } | null;
  };
}

function getPreviewFrame(page: Page): Frame {
  const frame = page.frames().find((candidate) => candidate.url().includes("preview.html"));
  if (!frame) throw new Error("preview iframe not found among page.frames()");
  return frame;
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
    ([wx, wy]) => {
      const debug = (window as unknown as { __forgeSceneCanvasDebug: { camera: { worldToScreen(x: number, y: number): { x: number; y: number } } } })
        .__forgeSceneCanvasDebug;
      return debug.camera.worldToScreen(wx, wy);
    },
    [world.x, world.y] as [number, number],
  );
  return { x: box.x + screen.x, y: box.y + screen.y };
}

async function enemyAlive(previewFrame: Frame): Promise<boolean> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    return gameWorld.world.isAlive(gameWorld.enemyEntity);
  });
}

async function repositionPlayerNextToEnemy(previewFrame: Frame): Promise<void> {
  await previewFrame.evaluate((reach) => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    const enemyTransform = gameWorld.world.get(gameWorld.enemyEntity, "Transform")!;
    gameWorld.world.set(gameWorld.enemyEntity, "Velocity", { vx: 0, vy: 0 });
    gameWorld.world.set(gameWorld.playerEntity!, "Transform", { x: enemyTransform.x! - reach, y: enemyTransform.y! });
    gameWorld.world.flush();
  }, MELEE_REACH);
}

async function setPlayerHealth(previewFrame: Frame, current: number, max: number): Promise<void> {
  await previewFrame.evaluate(
    ([c, m]) => {
      const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
      gameWorld.world.set(gameWorld.playerEntity!, "Health", { current: c, max: m });
      gameWorld.world.flush();
    },
    [current, max] as [number, number],
  );
}

test.describe("docs/adr/0017 M6: a non-programmer's graph-only mechanic, running in the real live preview", () => {
  test("building 'heal to full on coin pickup' entirely through the graph editor UI actually heals the player in the live preview", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.addInitScript(() => {
      (window as unknown as { __forgeTestDisableEnemyAggro: boolean }).__forgeTestDisableEnemyAggro = true;
    });

    await page.goto("/");

    // --- Build the graph, entirely through the UI. ---
    await page.getByRole("button", { name: "Create a graph" }).click();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const palette = dialog.getByRole("complementary", { name: "Node palette" });
    const outline = dialog.getByRole("tree", { name: "Graph Outline" });

    async function addAndConfigure(paletteLabel: string, fieldLabel: string, value: string): Promise<void> {
      await palette.getByRole("button", { name: paletteLabel }).click();
      await outline.getByText(paletteLabel).click();
      const input = dialog.getByLabel(fieldLabel);
      await input.fill(value);
      await input.blur();
    }

    await addAndConfigure("On Event", "Event name", "pickup:collected");
    await addAndConfigure("Get Field", "Field name", "player");
    await addAndConfigure("Constant (number)", "Value", "100");
    await addAndConfigure("Set Field", "Field name", "current");
    await addAndConfigure("Set Component", "Component", "Health");

    async function wire(fromLabel: string, outputSocket: string, toLabel: string): Promise<void> {
      await outline.getByText(fromLabel).click();
      await dialog.getByRole("button", { name: new RegExp(`^Output: ${outputSocket} \\(`) }).click();
      await dialog.getByRole("button", { name: new RegExp(`^${toLabel} \\(`) }).click();
    }

    await wire("On Event", "flow", "Set Component.flow");
    await wire("On Event", "payload", "Get Field.object");
    await wire("Constant (number)", "value", "Set Field.value");
    await wire("Set Field", "object", "Set Component.value");
    await wire("Get Field", "value", "Set Component.entity");

    // Real edges landed on the real React Flow canvas — not just store state.
    await expect(dialog.locator(".react-flow__edge")).toHaveCount(5);

    // dialog.press("Escape") targets the dialog's own (non-focusable) div;
    // focus a real element inside it first so the keydown actually
    // bubbles through Dialog's own onKeyDown handler.
    await dialog.getByLabel("Name").first().click();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // --- Set up a scene to prove it in: place the player, kill the demo enemy for a coin drop. ---
    await page.getByRole("button", { name: "Create a scene" }).click();
    await page.getByRole("radio", { name: "Player start" }).waitFor({ state: "visible" });
    await page.getByRole("radio", { name: "Player start" }).click();
    const playerStartPoint = await screenPointForTile(page, PLAYER_START.x, PLAYER_START.y);
    await page.mouse.click(playerStartPoint.x, playerStartPoint.y);

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

    // Damage the player first — healing to 100 from 100 would prove nothing.
    await setPlayerHealth(previewFrame, 40, 100);
    const healthBar = previewFrame.locator(".fg-preview-app__health-bar");
    await expect(healthBar).toHaveAttribute("aria-valuenow", "40");

    // Face east, real swings to kill the demo enemy (same sequencing
    // damageAndDeath.spec.ts/pickupAndHud.spec.ts establish) — repositions
    // before every swing (not just after the first) and allows up to 6
    // attempts rather than assuming exactly 3 connect: this spec's own
    // timing margin isn't proven as tight as those two specs' own, and a
    // deterministic kill matters far more here than an exact swing count
    // (verified empirically: 3 swings reliably kill the 30 HP demo enemy
    // once every swing actually connects).
    await repositionPlayerNextToEnemy(previewFrame);
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(80);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(150);

    for (let attempt = 0; attempt < 6 && (await enemyAlive(previewFrame)); attempt++) {
      await repositionPlayerNextToEnemy(previewFrame);
      await page.keyboard.press(" ");
      await page.waitForTimeout(550);
    }

    expect(await enemyAlive(previewFrame)).toBe(false);

    // Walk east onto the dropped coin — triggers a real pickup:collected
    // event, forwarded to @forge/graph-runtime's own graphEvents bus
    // (PreviewApp.tsx), reaching the graph built above.
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(400);
    await page.keyboard.up("ArrowRight");

    // The graph-only mechanic actually ran: full health, not just "some" healing.
    await expect(healthBar).toHaveAttribute("aria-valuenow", "100", { timeout: 3_000 });
    await expect(previewFrame.locator(".fg-preview-app__health-bar-label")).toHaveText("100/100");

    expect(consoleErrors, `unexpected console errors: ${consoleErrors.join("\n")}`).toEqual([]);
  });
});
