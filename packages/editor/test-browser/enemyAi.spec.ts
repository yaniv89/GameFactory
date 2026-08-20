import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * I1a's own exit bar, in a real browser: left alone (no swing, no
 * movement) near the demo enemy, the enemy notices the player on its own,
 * closes the distance, and lands real, repeated, cooldown-gated damage on
 * the player's own `Health` — reflected live in the HUD health bar.
 * `enemyAi.test.ts` (in `@forge/core`) already proves the pure
 * detect/chase/attack/cooldown logic in isolation; this proves the real
 * scheduler wiring (`createEnemyAiSystem` registered in `PreviewApp.tsx`,
 * given the same live `isWalkable` and `combatEvents` bus the player's own
 * swing uses) actually drives the demo enemy against a real player entity,
 * with nothing scripted or faked on the player's side.
 */

const TILE_SIZE = 32;
// Three tiles west of DEMO_ENEMY_TILE (13, 8) in PreviewApp.tsx — 96 world
// units away: inside ENEMY_DETECT_RADIUS (130) so the enemy notices and
// chases immediately, but well outside ENEMY_ATTACK_RANGE (24) so no hit
// lands before a real chase has actually happened.
const PLAYER_START = { x: 10, y: 8 };
const ENEMY_ATTACK_DAMAGE = 6; // must match PreviewApp.tsx's own ENEMY_ATTACK_DAMAGE

interface PreviewDebugWindow {
  __forgePreviewDebug?: {
    gameWorld: {
      playerEntity: number | undefined;
      enemyEntity: number;
      world: { get(id: number, component: string): Record<string, number> | undefined };
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

async function playerHealth(previewFrame: Frame): Promise<number> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    return gameWorld.world.get(gameWorld.playerEntity!, "Health")!.current!;
  });
}

async function playerTransform(previewFrame: Frame): Promise<{ x: number; y: number }> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    const transform = gameWorld.world.get(gameWorld.playerEntity!, "Transform")!;
    return { x: transform.x!, y: transform.y! };
  });
}

async function enemyTransform(previewFrame: Frame): Promise<{ x: number; y: number }> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    const transform = gameWorld.world.get(gameWorld.enemyEntity, "Transform")!;
    return { x: transform.x!, y: transform.y! };
  });
}

test.describe("I1a: enemy AI — detect, chase, attack, in a real browser", () => {
  test("an unprovoked, stationary player still gets chased down and hit by the demo enemy, taking real, cooldown-gated damage reflected in the HUD", async ({ page }) => {
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

    const healthBar = previewFrame.locator(".fg-preview-app__health-bar");
    const startTransform = await playerTransform(previewFrame);
    const startEnemy = await enemyTransform(previewFrame);
    expect(await playerHealth(previewFrame)).toBe(100); // untouched at spawn — still outside attackRange

    // No keys pressed at all from here — the player never moves and never
    // swings. Whatever happens next is entirely the enemy's own initiative.

    // The chase: the enemy closes real distance toward the player on its
    // own, well before it's close enough to land a hit. The player sits
    // west of the demo enemy's spawn (PLAYER_START.x < DEMO_ENEMY_TILE.x),
    // so a real chase moves the enemy's x *down*, toward the player.
    await expect
      .poll(async () => (await enemyTransform(previewFrame)).x, { timeout: 3_000, message: "enemy never chased the stationary player" })
      .toBeLessThan(startEnemy.x);

    // The first hit: real damage, cooldown-gated, reflected live in the HUD.
    await expect(healthBar).toHaveAttribute("aria-valuenow", String(100 - ENEMY_ATTACK_DAMAGE), { timeout: 4_000 });
    expect(await playerHealth(previewFrame)).toBe(100 - ENEMY_ATTACK_DAMAGE);
    await expect(previewFrame.locator(".fg-preview-app__health-bar-label")).toHaveText(`${100 - ENEMY_ATTACK_DAMAGE}/100`);
    const fillWidthAfterFirstHit = await previewFrame.locator(".fg-preview-app__health-bar-fill").evaluate((el) => el.style.width);
    expect(fillWidthAfterFirstHit).toBe(`${100 - ENEMY_ATTACK_DAMAGE}%`);

    // The second hit only lands once the enemy's own cooldown (1s) has
    // actually elapsed — proving this isn't a one-shot fluke or an
    // uncapped every-tick drain.
    await expect
      .poll(async () => playerHealth(previewFrame), { timeout: 4_000, message: "enemy never landed a second, cooldown-gated hit" })
      .toBe(100 - ENEMY_ATTACK_DAMAGE * 2);

    // Never knocked back or moved by the enemy's attack — I1a deliberately
    // never applies knockback or moves the player on a landed hit.
    const finalPlayerTransform = await playerTransform(previewFrame);
    expect(finalPlayerTransform.x).toBeCloseTo(startTransform.x, 5);
    expect(finalPlayerTransform.y).toBeCloseTo(startTransform.y, 5);

    expect(consoleErrors).toEqual([]);
  });
});
