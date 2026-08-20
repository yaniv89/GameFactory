import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * H1c's own exit bar, in a real browser: pressing Space in the live
 * preview actually swings at the demo enemy standing next to the player —
 * damages it, knocks it back away from the player, and flashes its sprite
 * red for a moment, then reverts. `meleeAttack.test.ts`/`knockbackPhysics.test.ts`/
 * `hitFlash.test.ts` (in `@forge/core`) already prove the pure system
 * logic in isolation; this proves the real keyboard binding, the real
 * demo enemy spawn, and the real Pixi tint actually wire together.
 */

const TILE_SIZE = 32;
// One tile left of DEMO_ENEMY_TILE (PreviewApp.tsx) — center-to-center
// distance exactly matches MELEE_REACH once the player briefly faces east,
// so a swing lands without any fussy sub-tile positioning.
const PLAYER_START = { x: 12, y: 8 };

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

async function enemyHealth(previewFrame: Frame): Promise<number> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    return gameWorld.world.get(gameWorld.enemyEntity, "Health")!.current!;
  });
}

async function enemyState(previewFrame: Frame): Promise<{ x: number; vx: number; tint: number }> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    const transform = gameWorld.world.get(gameWorld.enemyEntity, "Transform")!;
    const velocity = gameWorld.world.get(gameWorld.enemyEntity, "Velocity")!;
    const sprite = gameWorld.world.get(gameWorld.enemyEntity, "Sprite")!;
    return { x: transform.x!, vx: velocity.vx!, tint: sprite.tint! };
  });
}

test.describe("H1c: sword swing — hitbox, hit flash, knockback, in a real browser", () => {
  test("Space swings at the demo enemy: damages it, flashes it, and knocks it back", async ({ page }) => {
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

    const initialEnemy = await enemyState(previewFrame);
    expect(await enemyHealth(previewFrame)).toBe(30);

    // Face east — a brief tap, not enough travel to actually reach the
    // enemy's own tile, just enough for createCharacterAnimationSystem to
    // register the movement direction (Animator.facing holds it once
    // stopped).
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(80);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(150); // let velocity settle back to 0

    // Swing.
    await page.keyboard.press(" ");
    await page.waitForTimeout(50);

    expect(await enemyHealth(previewFrame)).toBe(20);
    const justHit = await enemyState(previewFrame);
    expect(justHit.tint).toBe(0xff5050); // flashing
    expect(justHit.vx).toBeGreaterThan(0); // knocked back east, away from the player to its west
    expect(justHit.x).toBeGreaterThan(initialEnemy.x); // already visibly moved

    // A second swing thrown immediately shouldn't double-hit — the target
    // is still inside its own invulnerability window.
    await page.keyboard.press(" ");
    await page.waitForTimeout(50);
    expect(await enemyHealth(previewFrame)).toBe(20);

    // The flash reverts once its window passes, independent of any further hits.
    await page.waitForTimeout(300);
    const settled = await enemyState(previewFrame);
    expect(settled.tint).toBe(0xffffff);

    expect(consoleErrors).toEqual([]);
  });
});
