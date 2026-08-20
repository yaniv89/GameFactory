import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * H1e's own exit bar, in a real browser: killing the demo enemy drops a
 * real, walkable-over coin at its last position, walking the player onto
 * it collects it and increments the HUD's coin slot, and the HUD's health
 * bar reflects the player's own live `Health` rather than a fixed number.
 * `pickup.test.ts` (in `@forge/core`) already proves the pure overlap/
 * destroy/event logic in isolation; this proves the real item-drop wiring
 * (`combat:death` -> `spawnCoinPickup`), the real walk-to-collect
 * interaction, and the real DOM-mutation HUD wiring actually connect.
 */

const TILE_SIZE = 32;
const PLAYER_START = { x: 12, y: 8 }; // one tile west of DEMO_ENEMY_TILE — see meleeAttack.spec.ts's own comment
const MELEE_REACH = 24; // must match PreviewApp.tsx's own MELEE_REACH
const COIN_PICKUP_COMBINED_RADIUS = 18; // player collider radius (10) + coin collider radius (8), both from prefab.ts

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

/** Same technique `damageAndDeath.spec.ts` establishes: re-close to melee reach and zero the enemy's own residual knockback drift so the next swing is guaranteed to connect deterministically. */
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

test.describe("H1e: item drop, pickup, and HUD health bar + slot, in a real browser", () => {
  test("killing the enemy drops a coin, walking onto it collects it and updates the HUD slot; the HUD health bar reflects real player Health", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

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

    // The HUD starts honest: a real, full health bar (nothing has damaged
    // the player yet) and an empty coin slot — not a placeholder.
    const healthBar = previewFrame.locator(".fg-preview-app__health-bar");
    await expect(healthBar).toHaveAttribute("aria-valuenow", "100");
    await expect(previewFrame.locator(".fg-preview-app__health-bar-label")).toHaveText("100/100");
    await expect(previewFrame.locator(".fg-preview-app__hud-item-count")).toHaveText("0");

    // The health bar is wired to real, live ECS state, not a fixed
    // number — even though nothing in this vertical slice currently
    // damages the player (no enemy AI exists before I1), a direct write
    // to the same `Health` component a future attacker would use proves
    // the DOM reacts to it.
    await setPlayerHealth(previewFrame, 57, 100);
    await expect(healthBar).toHaveAttribute("aria-valuenow", "57", { timeout: 2_000 });
    await expect(previewFrame.locator(".fg-preview-app__health-bar-label")).toHaveText("57/100");
    const fillWidth = await previewFrame.locator(".fg-preview-app__health-bar-fill").evaluate((el) => el.style.width);
    expect(fillWidth).toBe("57%");
    await setPlayerHealth(previewFrame, 100, 100); // restore for the rest of the test

    // Face east.
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(80);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(150);

    // Three real swings (same sequencing damageAndDeath.spec.ts establishes:
    // wait past invulnerability, then reposition, then swing immediately —
    // reposition-then-wait would let the enemy's own knockback drift carry
    // it back out of reach during the wait).
    await page.keyboard.press(" ");
    await page.waitForTimeout(550);
    await repositionPlayerNextToEnemy(previewFrame);
    await page.keyboard.press(" ");
    await page.waitForTimeout(550);
    await repositionPlayerNextToEnemy(previewFrame);
    await page.keyboard.press(" ");
    await page.waitForTimeout(50);

    expect(await enemyAlive(previewFrame)).toBe(false);

    // The drop lands `MELEE_REACH` (24) from the player, outside the
    // player+coin combined pickup radius (18) — it takes a real walk to
    // collect it, not an automatic grant on the killing blow.
    expect(MELEE_REACH).toBeGreaterThan(COIN_PICKUP_COMBINED_RADIUS);
    await expect(previewFrame.locator(".fg-preview-app__hud-item-count")).toHaveText("0");

    // Walk east toward the coin (dropped `MELEE_REACH` east of the player
    // at this point) — comfortably enough real movement (maxSpeed 140/s)
    // to close that gap and overlap its own trigger collider.
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(400);
    await page.keyboard.up("ArrowRight");

    await expect(previewFrame.locator(".fg-preview-app__hud-item-count")).toHaveText("1", { timeout: 2_000 });
    await expect(previewFrame.locator(".fg-preview-app__hud-item-slot")).toHaveAttribute("aria-label", "Coins collected: 1");

    expect(consoleErrors).toEqual([]);
  });
});
