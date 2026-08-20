import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * I1e's own exit bar, in a real browser: collecting a coin now lands in a
 * real, running `@forge/inventory` module (unsandboxed, the same
 * documented exception `createModuleRuntime`'s own doc comment already
 * states for `@forge/dialogue`) — not just an independently-incremented
 * HUD counter with no real state behind it. `pickupAndHud.spec.ts` already
 * proves the HUD's own slot count reacts to a real pickup; this proves the
 * module *itself* actually holds the item (`ctx.storage`) and answers a
 * real `inventory:query`/`inventory:queried` round trip — the same public
 * event contract a future quest/graph system would use, not a shortcut
 * this preview alone benefits from.
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
    inventoryRuntime: {
      ctx: { storage: { get<T>(key: string): T | null } };
      events: {
        emit(event: string, payload: unknown): void;
        on(event: string, handler: (payload: unknown) => void): void;
      };
    };
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

test.describe("I1e: real @forge/inventory state in the live preview, in a real browser", () => {
  test("collecting a coin adds it to the real inventory module — provable via ctx.storage and a real inventory:query round trip", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    // Same reasoning pickupAndHud.spec.ts's own doc comment already states.
    await page.addInitScript(() => {
      (window as unknown as { __forgeTestDisableEnemyAggro: boolean }).__forgeTestDisableEnemyAggro = true;
    });

    await page.goto("/");
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

    const playerEntity = await previewFrame.evaluate(
      () => (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!.playerEntity!,
    );

    // Nothing collected yet — the module's own storage is genuinely empty,
    // not defaulted-but-untested.
    const beforeContents = await previewFrame.evaluate(
      (entity) => (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.inventoryRuntime.ctx.storage.get(`inv:${entity}`),
      playerEntity,
    );
    expect(beforeContents).toBeNull();

    // Kill the enemy and walk onto the coin it drops — same real sequence
    // pickupAndHud.spec.ts already establishes.
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(80);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(150);
    await page.keyboard.press(" ");
    await page.waitForTimeout(550);
    await repositionPlayerNextToEnemy(previewFrame);
    await page.keyboard.press(" ");
    await page.waitForTimeout(550);
    await repositionPlayerNextToEnemy(previewFrame);
    await page.keyboard.press(" ");
    await page.waitForTimeout(50);
    expect(await enemyAlive(previewFrame)).toBe(false);

    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(400);
    await page.keyboard.up("ArrowRight");
    await expect(previewFrame.locator(".fg-preview-app__hud-item-count")).toHaveText("1", { timeout: 2_000 });

    // The real module now genuinely holds it.
    const afterContents = await previewFrame.evaluate(
      (entity) => (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.inventoryRuntime.ctx.storage.get(`inv:${entity}`),
      playerEntity,
    );
    expect(afterContents).toEqual({ coin: 1 });

    // And the real public event contract answers a genuine query — not
    // just introspectable storage, the actual API a quest/graph system
    // would call.
    const queried = await previewFrame.evaluate((entity) => {
      const inventoryRuntime = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.inventoryRuntime;
      return new Promise((resolve) => {
        inventoryRuntime.events.on("inventory:queried", resolve);
        inventoryRuntime.events.emit("inventory:query", { entity });
      });
    }, playerEntity);
    expect(queried).toEqual({ entity: playerEntity, items: { coin: 1 } });

    expect(consoleErrors).toEqual([]);
  });
});
