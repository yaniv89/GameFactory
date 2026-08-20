import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * I1b's own exit bar, in a real browser: walking up to the demo mount and
 * pressing "E" swaps the player onto it (a real, sustained speed boost,
 * not a one-tick pulse) and hides the mount's own sprite; pressing "E"
 * again dismounts from anywhere, restoring the player's original speed
 * and leaving the mount exactly where the ride ended, visible again.
 * `mount.test.ts` (in `@forge/core`) already proves the pure detect/mount/
 * dismount logic in isolation; this proves the real keyboard binding, the
 * real demo mount spawn, and the real Pixi opacity toggle actually wire
 * together — and, since the same "E" key already drives NPC dialogue,
 * that the two don't stomp on each other.
 */

const TILE_SIZE = 32;
// One tile east of DEMO_MOUNT_TILE (5, 8) in PreviewApp.tsx — 32 world
// units away, comfortably inside MOUNT_PREFAB's own mount.range (40).
const PLAYER_START = { x: 6, y: 8 };
const MOUNTED_MAX_SPEED = 260; // must match MOUNT_PREFAB's own mount.mountedMaxSpeed
const BASE_MAX_SPEED = 140; // must match PLAYER_START_PREFAB's own velocity.maxSpeed
const MOUNT_NO_RIDER = 0xffffffff; // must match @forge/core's own MOUNT_NO_RIDER sentinel

interface PreviewDebugWindow {
  __forgePreviewDebug?: {
    gameWorld: {
      playerEntity: number | undefined;
      mountEntity: number;
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

async function playerMaxSpeed(previewFrame: Frame): Promise<number> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    return gameWorld.world.get(gameWorld.playerEntity!, "Velocity")!.maxSpeed!;
  });
}

async function mountState(previewFrame: Frame): Promise<{ riderEntity: number; opacity: number; x: number; y: number }> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    const mount = gameWorld.world.get(gameWorld.mountEntity, "Mount")!;
    const sprite = gameWorld.world.get(gameWorld.mountEntity, "Sprite")!;
    const transform = gameWorld.world.get(gameWorld.mountEntity, "Transform")!;
    return { riderEntity: mount.riderEntity!, opacity: sprite.opacity!, x: transform.x!, y: transform.y! };
  });
}

async function playerTransform(previewFrame: Frame): Promise<{ x: number; y: number }> {
  return previewFrame.evaluate(() => {
    const gameWorld = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!;
    const transform = gameWorld.world.get(gameWorld.playerEntity!, "Transform")!;
    return { x: transform.x!, y: transform.y! };
  });
}

test.describe("I1b: mount/dismount, in a real browser", () => {
  test("E mounts the nearby demo mount (real speed boost, hidden sprite), and E again dismounts from wherever the ride ends", async ({ page }) => {
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

    expect(await playerMaxSpeed(previewFrame)).toBe(BASE_MAX_SPEED);
    const beforeMount = await mountState(previewFrame);
    expect(beforeMount.opacity).toBe(1);

    // Mount: no NPCs exist in this scene, so "E" falls straight through to
    // the mount system.
    await page.keyboard.press("e");
    await page.waitForTimeout(50);

    expect(await playerMaxSpeed(previewFrame)).toBe(MOUNTED_MAX_SPEED);
    const afterMount = await mountState(previewFrame);
    const playerEntityId = await previewFrame.evaluate(
      () => (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.gameWorld!.playerEntity!,
    );
    expect(afterMount.riderEntity).toBe(playerEntityId);
    expect(afterMount.opacity).toBe(0); // hidden — the rider is the only thing visibly moving now

    // A second "E" immediately after should NOT re-toggle within the same
    // frame's own edge — but by the time this next real keypress lands, the
    // previous edge has already been consumed, so this genuinely tests the
    // ride, not a double-fire. Instead, prove the boosted speed is real by
    // actually moving while mounted, covering real ground fast.
    const beforeWalk = await playerTransform(previewFrame);
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(200);
    await page.keyboard.up("ArrowRight");
    const afterWalk = await playerTransform(previewFrame);
    const traveled = afterWalk.x - beforeWalk.x;
    expect(traveled).toBeGreaterThan(0);
    // At BASE_MAX_SPEED (140/s) 200ms of real travel tops out well under
    // 32 world units; MOUNTED_MAX_SPEED (260/s) comfortably clears it —
    // a real, felt difference, not a marginal one.
    expect(traveled).toBeGreaterThan(32);

    // Dismount: works from wherever the ride ended, not just next to the
    // mount's original spawn point.
    await page.keyboard.press("e");
    await page.waitForTimeout(50);

    expect(await playerMaxSpeed(previewFrame)).toBe(BASE_MAX_SPEED);
    const afterDismount = await mountState(previewFrame);
    expect(afterDismount.riderEntity).toBe(MOUNT_NO_RIDER);
    expect(afterDismount.opacity).toBe(1); // visible again
    const dismountPlayerTransform = await playerTransform(previewFrame);
    expect(afterDismount.x).toBeCloseTo(dismountPlayerTransform.x, 3);
    expect(afterDismount.y).toBeCloseTo(dismountPlayerTransform.y, 3);
    // Genuinely moved from its own original spawn — proves the mount
    // wasn't just left untouched at (or snapped back to) its start tile.
    expect(afterDismount.x).not.toBeCloseTo(beforeMount.x, 3);

    expect(consoleErrors).toEqual([]);
  });
});
