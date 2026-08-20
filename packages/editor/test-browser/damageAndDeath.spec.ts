import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * H1d's own exit bar, in a real browser: hitting the demo enemy spawns a
 * real floating "-10" text that rises and fades, and killing it destroys
 * the entity and bursts real particles at its last position.
 * `floatingText.test.ts`/`textSync.test.ts` already prove the pure
 * aging/fade logic and the ECS-to-Pixi sync in isolation, and
 * `meleeAttack.test.ts` already proves the health-to-zero/`combat:death`
 * logic itself in isolation; this proves the real event wiring
 * (`combat:hit` -> spawn a FloatingText entity, `combat:death` -> spawn a
 * Graphics burst) actually fires in the running preview.
 *
 * Re-positions the player directly (via the debug hook's real `World`,
 * not a UI shortcut) before the second and third swings rather than
 * predicting exactly where knockback drift left the enemy — the point of
 * *this* test is proving the event wiring reacts correctly to a real
 * `combat:hit`/`combat:death`, not re-deriving the knockback-physics
 * math `knockbackPhysics.test.ts` already covers.
 */

const TILE_SIZE = 32;
const PLAYER_START = { x: 12, y: 8 }; // one tile west of DEMO_ENEMY_TILE — see meleeAttack.spec.ts's own comment
const MELEE_REACH = 24; // must match PreviewApp.tsx's own MELEE_REACH

interface PreviewDebugWindow {
  __forgePreviewDebug?: {
    host: { worldContainer: { children: readonly { text?: string; alpha: number }[] } };
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

async function worldContainerChildCount(previewFrame: Frame): Promise<number> {
  return previewFrame.evaluate(() => (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.host.worldContainer.children.length);
}

async function findFloatingDamageText(previewFrame: Frame): Promise<{ text: string; alpha: number } | undefined> {
  return previewFrame.evaluate(() => {
    const children = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.host.worldContainer.children;
    const match = children.find((child) => child.text !== undefined);
    // Pixi's Text.text/.alpha are prototype getters — copied into a plain
    // object here since the raw class instance wouldn't survive
    // Playwright's evaluate() serialization boundary back to the test.
    return match ? { text: match.text!, alpha: match.alpha } : undefined;
  });
}

async function enemyAlive(previewFrame: Frame): Promise<boolean> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    return gameWorld.world.isAlive(gameWorld.enemyEntity);
  });
}

/**
 * I1a gave the demo enemy its own real AI — it now notices and attacks the
 * player unprompted (proven, on its own terms, by `enemyAi.spec.ts`). This
 * spec's own `PLAYER_START` sits well within `ENEMY_DETECT_RADIUS`, so
 * without disarming it, the enemy's own real retaliation would land during
 * this test's real-time waits and pollute `findFloatingDamageText`'s
 * "first FloatingText entity" lookup with the enemy's own damage number
 * instead of the player's.
 *
 * A post-boot debug-hook mutation can't reliably win this race: by the
 * time any test code can poll for `enemyEntity`/`playerEntity` and
 * round-trip a write back into the iframe, real wall-clock time (and real
 * game ticks) have already elapsed — verified the hard way, this landed
 * the enemy's own first hit before a poll-then-mutate fix could ever catch
 * it. `page.addInitScript` (in the test body below) sets a DEV-only flag
 * on `window` *before the iframe's own scripts run at all*, and
 * `PreviewApp.tsx`'s own boot effect checks it and pins the demo enemy's
 * `EnemyAi.attackCooldownUntil` (never its `Health.invulnerableUntil` —
 * that field also gates whether the player's own swings can land, via
 * `createMeleeAttackSystem`'s own check, which would make the enemy
 * unkillable) before its very first tick. `enemyAi.spec.ts` is the one
 * spec that deliberately never sets this flag, since proving the real
 * attack is its whole point. Test-setup isolation, not faking the
 * mechanic actually under test here (the hit/death event wiring).
 *
 * Re-closes to melee reach of the (possibly knocked-back) enemy by moving
 * the player directly, so the next swing is guaranteed to connect. Also
 * zeroes the enemy's own residual knockback velocity — without that, its
 * exponential-decay drift (`knockbackPhysics.test.ts` covers the curve
 * itself) continues for roughly another second after a hit, so it would
 * still be moving away during whatever delay real key-press timing needs
 * before the next swing, carrying it back out of reach.
 */
async function repositionPlayerNextToEnemy(previewFrame: Frame): Promise<void> {
  await previewFrame.evaluate((reach) => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    if (gameWorld.playerEntity === undefined || !gameWorld.world.isAlive(gameWorld.enemyEntity)) return;
    const enemyTransform = gameWorld.world.get(gameWorld.enemyEntity, "Transform")!;
    gameWorld.world.set(gameWorld.enemyEntity, "Velocity", { vx: 0, vy: 0 });
    gameWorld.world.set(gameWorld.playerEntity, "Transform", { x: enemyTransform.x! - reach, y: enemyTransform.y! });
    gameWorld.world.flush();
  }, MELEE_REACH);
}

test.describe("H1d: floating damage number + enemy death particle burst, in a real browser", () => {
  test("a hit spawns a fading '-10' number, and a lethal blow bursts particles and removes the enemy", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    // See repositionPlayerNextToEnemy's own doc comment above for why this
    // has to be an init script, not a post-boot debug-hook write.
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

    // Face east.
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(80);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(150);

    // 1. First swing: a real "-10" floating number appears, fully opaque
    // right after spawning, and actually fades and disappears over its
    // own ttl (0.8s) — not left behind forever.
    await page.keyboard.press(" ");
    await page.waitForTimeout(50);
    const damageText = await findFloatingDamageText(previewFrame);
    expect(damageText?.text).toBe("-10");
    expect(damageText!.alpha).toBeGreaterThan(0.8);

    await page.waitForTimeout(1000);
    expect(await findFloatingDamageText(previewFrame)).toBeUndefined();
    expect(await enemyAlive(previewFrame)).toBe(true); // 30 health, one 10-damage hit landed

    // 2. Second swing (not lethal: 20 -> 10 health). Waits for
    // MELEE_INVULNERABILITY_SEC (0.4s) to pass *before* repositioning —
    // repositioning first and then waiting would let the enemy's own
    // still-decaying knockback velocity (zeroed by the reposition, but
    // only at that instant) carry it back out of reach during the wait.
    await page.waitForTimeout(500);
    await repositionPlayerNextToEnemy(previewFrame);
    await page.keyboard.press(" ");
    await page.waitForTimeout(50);
    expect(await enemyAlive(previewFrame)).toBe(true);

    // 3. Third, lethal swing (10 -> 0 health).
    await page.waitForTimeout(500);
    await repositionPlayerNextToEnemy(previewFrame);
    const childCountBeforeKill = await worldContainerChildCount(previewFrame);
    await page.keyboard.press(" ");
    await page.waitForTimeout(50);

    expect(await enemyAlive(previewFrame)).toBe(false);
    const childCountRightAfterKill = await worldContainerChildCount(previewFrame);
    // The enemy sprite itself is gone, but a burst of particle children
    // replaced it — net child count should still be higher than before
    // the kill (10 particles spawned, 1 sprite removed).
    expect(childCountRightAfterKill).toBeGreaterThan(childCountBeforeKill);

    // The burst itself fades away and gets cleaned up too, not left
    // behind forever (ttl 0.5s).
    await page.waitForTimeout(800);
    const childCountAfterBurstFades = await worldContainerChildCount(previewFrame);
    expect(childCountAfterBurstFades).toBeLessThan(childCountRightAfterKill);

    expect(consoleErrors).toEqual([]);
  });
});
