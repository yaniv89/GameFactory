import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * I1d's own exit bar, in a real browser: a landed (non-lethal) swing spawns
 * a real impact-spark burst — not just the floating damage number H1d
 * already proved — and those particles genuinely fade and get destroyed on
 * their own, not left behind. `vfx.test.ts` (in `@forge/core`) already
 * proves `spawnVfxBurst`/`createVfxParticleSystem`'s pure logic in
 * isolation; this proves the real event wiring (`combat:hit` ->
 * `spawnVfxBurst(..., IMPACT_SPARK_OPTIONS)`) actually fires in the running
 * preview, and that these particles are real `VfxParticle` ECS entities —
 * not the ad hoc `Pixi.Graphics` state H1d's original death burst used —
 * so `damageAndDeath.spec.ts`'s own kill-burst assertions keep proving the
 * same real system, not two different code paths.
 */

const TILE_SIZE = 32;
const PLAYER_START = { x: 12, y: 8 }; // one tile west of DEMO_ENEMY_TILE — see meleeAttack.spec.ts's own comment
const IMPACT_SPARK_COUNT = 5; // must match PreviewApp.tsx's own IMPACT_SPARK_OPTIONS.count
const IMPACT_SPARK_TTL_SEC = 0.25; // must match PreviewApp.tsx's own IMPACT_SPARK_OPTIONS.ttl

interface PreviewDebugWindow {
  __forgePreviewDebug?: {
    gameWorld: {
      playerEntity: number | undefined;
      world: {
        query(components: string[]): { forEach(callback: (entity: number) => void): void };
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

async function vfxParticleCount(previewFrame: Frame): Promise<number> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    let count = 0;
    gameWorld.world.query(["Transform", "Velocity", "Sprite", "VfxParticle"]).forEach(() => count++);
    return count;
  });
}

test.describe("I1d: hit-effect pipeline, in a real browser", () => {
  test("a landed swing spawns a real, ECS-driven impact-spark burst that fades and destroys itself", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    // I1a gave the demo enemy its own real AI — it would otherwise notice
    // and attack the player unprompted (PLAYER_START sits within its own
    // detect/attack range), and since I1d's own impact spark now fires on
    // *any* landed hit, an unrelated enemy-initiated hit would pollute the
    // particle count this test is trying to attribute to the player's own
    // swing. See damageAndDeath.spec.ts's own copy of this same reasoning
    // for why this has to be an init script, not a post-boot debug-hook
    // write.
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

    expect(await vfxParticleCount(previewFrame)).toBe(0); // nothing has happened yet

    // Face east, then swing — same sequencing meleeAttack.spec.ts already establishes.
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(80);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(150);
    await page.keyboard.press(" ");
    await page.waitForTimeout(30); // land well within IMPACT_SPARK_TTL_SEC, before any particle could have aged out

    expect(await vfxParticleCount(previewFrame)).toBe(IMPACT_SPARK_COUNT);

    // Left alone, the burst fades and cleans itself up — the exact ECS
    // aging/destroy behavior vfx.test.ts already proves in isolation, now
    // proven wired into the real scheduler.
    await page.waitForTimeout(IMPACT_SPARK_TTL_SEC * 1000 + 200);
    expect(await vfxParticleCount(previewFrame)).toBe(0);

    expect(consoleErrors).toEqual([]);
  });
});
