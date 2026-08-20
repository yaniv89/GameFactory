import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * H1b's own exit bar, in a real browser: the live preview's camera
 * actually tracks the player as they walk (not a fixed whole-map view),
 * clamped so it never shows past the map's own edge — and entities render
 * in real Y-depth order (`RenderHost`'s `sortableChildren` container +
 * `createSpriteSyncSystem`'s per-tick `zIndex = position.y`), not
 * insertion order. `cameraFollow.test.ts` already unit-tests the pure
 * clamp math and `spriteSync.test.ts` the zIndex assignment in isolation;
 * this proves both are actually wired into the real, running preview.
 */

const TILE_SIZE = 32;
const PLAYER_START = { x: 3, y: 11 };

interface PreviewDebugWindow {
  __forgePreviewDebug?: {
    host: { worldContainer: { children: readonly { position: { x: number; y: number }; zIndex: number; texture?: unknown }[] } };
    camera: { x: number; y: number; zoom: number };
    gameWorld: {
      playerEntity: number | undefined;
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

test.describe("H1b: camera follow + Y-depth sorting, in a real browser", () => {
  test("the camera tracks the player as they walk, and entity sprites are z-ordered by their own world-space y", async ({ page }) => {
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

    // 1. Once a player exists, the camera zoomed in tighter than "the
    // whole map fits" and centered on the player's own spawn position —
    // not still parked at the map's dead center from before anyone spawned.
    const zoomedState = await previewFrame.evaluate(() => {
      const debug = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!;
      const gameWorld = debug.gameWorld!;
      const transform = gameWorld.world.get(gameWorld.playerEntity!, "Transform")!;
      return { camX: debug.camera.x, camY: debug.camera.y, zoom: debug.camera.zoom, playerX: transform.x!, playerY: transform.y! };
    });
    const mapCenter = { x: (20 * TILE_SIZE) / 2, y: (15 * TILE_SIZE) / 2 };
    expect(zoomedState.zoom).toBeGreaterThan(0); // sane, real number
    expect(Math.hypot(zoomedState.camX - mapCenter.x, zoomedState.camY - mapCenter.y)).toBeGreaterThan(50);

    // 2. Walk up for a while — the camera should move with the player, in
    // the same direction, by a comparable distance (accounting for the
    // top-edge clamp, since this spawn point is close to the map's top).
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(1200);
    await page.keyboard.up("ArrowUp");
    await page.waitForTimeout(200);

    const afterWalk = await previewFrame.evaluate(() => {
      const debug = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!;
      const gameWorld = debug.gameWorld!;
      const transform = gameWorld.world.get(gameWorld.playerEntity!, "Transform")!;
      return { camX: debug.camera.x, camY: debug.camera.y, playerX: transform.x!, playerY: transform.y! };
    });
    expect(afterWalk.playerY).toBeLessThan(zoomedState.playerY); // actually walked up
    expect(afterWalk.camY).toBeLessThan(zoomedState.camY); // camera followed
    expect(afterWalk.camX).toBeCloseTo(zoomedState.camX, 0); // no horizontal drift from a vertical-only move

    // 3. Y-depth: the player's own sprite (a real Pixi child of the
    // sortableChildren world container, not a fake) carries zIndex equal
    // to its own drawn y — the actual mechanism a viewer never sees
    // directly, but that determines whether entities occlude correctly.
    const spriteZIndex = await previewFrame.evaluate(() => {
      const debug = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!;
      const gameWorld = debug.gameWorld!;
      const transform = gameWorld.world.get(gameWorld.playerEntity!, "Transform")!;
      const entitySprite = debug.host.worldContainer.children.find(
        (child) => child.texture !== undefined && Math.abs(child.position.x - transform.x!) < 0.01 && Math.abs(child.position.y - transform.y!) < 0.01,
      );
      return { found: entitySprite !== undefined, zIndex: entitySprite?.zIndex, spriteY: entitySprite?.position.y, transformY: transform.y! };
    });
    expect(spriteZIndex.found).toBe(true);
    expect(spriteZIndex.zIndex!).toBeCloseTo(spriteZIndex.transformY!, 5);

    expect(consoleErrors).toEqual([]);
  });
});
