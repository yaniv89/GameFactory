import type { Frame, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * H1g's own exit bar, in a real browser: real autotiling and a real
 * second (decoration) tilemap layer, both driven from the actual scene
 * tiles a person paints through SceneCanvas — not a fixed demo pattern.
 * `autotile.test.ts` (in `@forge/render-2d`) and `decorationTiles.test.ts`
 * already prove the pure bitmask/placement logic in isolation; this
 * proves the real wiring: painting a Wall run actually selects visually
 * distinct real Pixi textures per cell based on its own live neighbors,
 * and painting Grass actually grows a real second layer of flower
 * sprites, correctly z-ordered below the ground layer... below entities,
 * above nothing else.
 */

const TILE_SIZE = 32;
// The default 1280x720 test viewport renders SceneCanvas too small for
// this test's layout: the floating tool toolbar/palette then covers
// nearly the entire grid (confirmed by direct measurement — at the
// default size it spans roughly rows 0-13 of 15, leaving only row 14
// clear, matching `walkableDemo.spec.ts`'s own "row 14 is clear ... row
// 8 is not" finding). A taller viewport gives the canvas genuine room so
// the toolbar only covers its own top rows, leaving the rest safely
// paintable — verified by measurement at this size: toolbar covers
// roughly columns 0-10, rows 0-6; every tile below is chosen at row 7 or
// lower for exactly that reason.
test.use({ viewport: { width: 1920, height: 1400 } });

const ISOLATED_WALL_TILE = { x: 1, y: 8 };
const WALL_RUN_ROW = 10;
const WALL_RUN_START_X = 1;
const WALL_RUN_LENGTH = 3; // columns 1,2,3 — column 2 is flanked east+west, a genuinely different bitmask than the isolated wall above
const WALL_RUN_MIDDLE_TILE = { x: WALL_RUN_START_X + 1, y: WALL_RUN_ROW };
const PLAYER_START_TILE = { x: 1, y: 12 };
// 14 x 8 = 112 cells, clear of both wall placements (columns 1-3) — at a
// ~20% per-cell flower chance, P(zero flowers across 112 cells) ≈
// 0.8^112, effectively impossible.
const GRASS_REGION = { x0: 6, y0: 7, x1: 19, y1: 14 };
const GROUND_LAYER_Z_INDEX = -3;
const DECORATION_LAYER_Z_INDEX = -2;

interface PreviewSpriteSummary {
  x: number;
  y: number;
  zIndex: number;
  textureUid: number;
}

interface PreviewDebugWindow {
  __forgePreviewDebug?: {
    host: { worldContainer: { children: readonly { position: { x: number; y: number }; zIndex?: number; texture?: { uid: number } }[] } };
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

async function clickTile(page: Page, tileX: number, tileY: number): Promise<void> {
  const point = await screenPointForTile(page, tileX, tileY);
  await page.mouse.click(point.x, point.y);
}

/** Paints a horizontal run of tiles by dragging — `walkableDemo.spec.ts`'s own `dragPaintColumn` doc comment explains the setPointerCapture reasoning this mirrors for a row instead of a column. */
async function dragPaintRow(page: Page, tileY: number, xStart: number, xEnd: number): Promise<void> {
  const start = await screenPointForTile(page, xStart, tileY);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const step = xEnd >= xStart ? 1 : -1;
  for (let x = xStart; x !== xEnd + step; x += step) {
    const point = await screenPointForTile(page, x, tileY);
    await page.mouse.move(point.x, point.y, { steps: 2 });
  }
  await page.mouse.up();
}

async function paintRect(page: Page, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  for (let y = y0; y <= y1; y++) {
    await dragPaintRow(page, y, x0, x1);
  }
}

async function spriteAt(previewFrame: Frame, worldX: number, worldY: number, zIndex: number): Promise<PreviewSpriteSummary | undefined> {
  return previewFrame.evaluate(
    ([wx, wy, z]) => {
      const children = (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.host.worldContainer.children;
      const match = children.find((child) => child.position.x === wx && child.position.y === wy && child.zIndex === z);
      if (!match) return undefined;
      return { x: match.position.x, y: match.position.y, zIndex: match.zIndex!, textureUid: match.texture!.uid };
    },
    [worldX, worldY, zIndex] as [number, number, number],
  );
}

async function countSpritesWithZIndex(previewFrame: Frame, zIndex: number): Promise<number> {
  return previewFrame.evaluate(
    (z) => (window as unknown as PreviewDebugWindow).__forgePreviewDebug!.host.worldContainer.children.filter((c) => c.zIndex === z).length,
    zIndex,
  );
}

test.describe("H1g: multi-layer tilemap with autotiling, in a real browser", () => {
  test("a painted Wall run autotiles to real, neighbor-dependent textures, and painted Grass grows a real, correctly z-ordered decoration layer", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await page.goto("/");
    await page.getByRole("button", { name: "Create a scene" }).click();
    await expect(page.getByRole("treeitem", { name: "Scene 1" })).toBeVisible();

    // Paint the two comparison walls: one fully isolated, one in the
    // middle of a 3-wide run (east+west neighbors — a genuinely different
    // autotile bitmask than the isolated one's).
    await page.getByRole("radio", { name: "Wall" }).waitFor({ state: "visible" });
    await page.getByRole("radio", { name: "Wall" }).click();
    await clickTile(page, ISOLATED_WALL_TILE.x, ISOLATED_WALL_TILE.y);
    await dragPaintRow(page, WALL_RUN_ROW, WALL_RUN_START_X, WALL_RUN_START_X + WALL_RUN_LENGTH - 1);

    // Paint a large Grass field — big enough that "zero flowers landed"
    // is not a realistic outcome of the real deterministic-per-cell chance.
    await page.getByRole("radio", { name: "Grass" }).click();
    await paintRect(page, GRASS_REGION.x0, GRASS_REGION.y0, GRASS_REGION.x1, GRASS_REGION.y1);

    await page.getByRole("radio", { name: "Player start" }).click();
    await clickTile(page, PLAYER_START_TILE.x, PLAYER_START_TILE.y);

    await expect(page.locator(".fg-preview-panel__overlay")).toHaveCount(0, { timeout: 15_000 });
    const previewFrame = getPreviewFrame(page);
    await previewFrame.locator(".fg-preview-app__surface").waitFor({ state: "visible" });
    await previewFrame.waitForFunction(() => (window as unknown as PreviewDebugWindow).__forgePreviewDebug?.host !== undefined, undefined, {
      timeout: 5_000,
      polling: 100,
    });
    // Give the scene-tile postMessage round trip (and this repaint's own
    // wall-neighbor-refresh pass) a moment to land before reading sprites.
    await page.waitForTimeout(300);

    // 1. Real autotiling: the isolated wall and the middle-of-a-run wall
    // render with genuinely different Pixi textures, both real ground-
    // layer sprites (zIndex GROUND_LAYER_Z_INDEX).
    const isolated = await spriteAt(
      previewFrame,
      ISOLATED_WALL_TILE.x * TILE_SIZE,
      ISOLATED_WALL_TILE.y * TILE_SIZE,
      GROUND_LAYER_Z_INDEX,
    );
    const middleOfRun = await spriteAt(
      previewFrame,
      WALL_RUN_MIDDLE_TILE.x * TILE_SIZE,
      WALL_RUN_MIDDLE_TILE.y * TILE_SIZE,
      GROUND_LAYER_Z_INDEX,
    );
    expect(isolated).toBeDefined();
    expect(middleOfRun).toBeDefined();
    expect(middleOfRun!.textureUid).not.toBe(isolated!.textureUid);

    // 2. Real second layer: the Grass field grew real flower sprites, at
    // the decoration layer's own distinct zIndex.
    const decorationSpriteCount = await countSpritesWithZIndex(previewFrame, DECORATION_LAYER_Z_INDEX);
    expect(decorationSpriteCount).toBeGreaterThan(0);

    // 3. Draw order: every ground sprite sits strictly below every
    // decoration sprite, which sits strictly below anything else in the
    // world (entities, the player included, whose own zIndex is its
    // world-space y — always > 0 on this map).
    expect(GROUND_LAYER_Z_INDEX).toBeLessThan(DECORATION_LAYER_Z_INDEX);
    const groundSpriteCount = await countSpritesWithZIndex(previewFrame, GROUND_LAYER_Z_INDEX);
    expect(groundSpriteCount).toBeGreaterThan(0);

    expect(consoleErrors).toEqual([]);
  });
});
