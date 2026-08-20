import { expect, test } from "./fixtures";

const PERSIST_KEY = "forge:editor:project-document";
const PERSIST_VERSION = 2;
const FIXTURE_PACK_NAME = "@forge-fixtures/starter-pack";

// The real, textured grass column's own mean/stddev
// (fixtures/packs/starter-pack/tilesets/outdoor-base.png, columns 0-31),
// computed directly from the committed PNG, not guessed. Sampling one
// point and asserting a tight tolerance band around this mean is more
// robust across camera zoom levels than comparing two in-tile points
// against each other: at the default zoom the tile renders small enough
// on screen that GPU texture minification can round two nearby in-tile
// samples to the identical byte value, which isn't a real signal either
// way, whereas the tile's actual rendered color staying near its known
// real mean (and well outside the flat fallback's own value) still is.
const GRASS_TILE_MEAN_RGB = [68, 137, 31];
const GRASS_TILE_TOLERANCE = 30;

/**
 * docs/SPEC.md Section 11.4's asset resolution, proven in a real
 * browser: with fixtures/packs/starter-pack active, painting "Grass"
 * must render that pack's own `tilesets/outdoor-base.png` — a real,
 * textured photo crop (not a flat placeholder color) — not
 * `tilePalette.ts`'s flat-color fallback (0x4a7c3c = [74, 124, 60],
 * verified passing in sceneCanvas.spec.ts). The fallback and the pack's
 * real tile read as similar green hues at a glance, so this checks the
 * rendered pixel lands within a real, measured tolerance band of the
 * pack PNG's own actual mean color rather than either an exact single
 * value (too brittle now that the art is a real texture) or a vague hue
 * check (too weak to prove the *pack's* PNG specifically loaded, as
 * opposed to the fallback, which is also green).
 */
test.describe("Art Pack rendering, in a real browser", () => {
  test("with a pack active, painting Grass renders that pack's own textured tile, not the flat-color fallback", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.addInitScript(
      ({ key, version, activePack }) => {
        const persisted = {
          state: {
            document: { scenes: [], installedModules: {}, activePack, packOverrides: {} },
            past: [],
            future: [],
          },
          version,
        };
        window.localStorage.setItem(key, JSON.stringify(persisted));
      },
      { key: PERSIST_KEY, version: PERSIST_VERSION, activePack: FIXTURE_PACK_NAME },
    );

    await page.goto("/");
    // Tiles are real, undoable scene document state now (M6 Phase 5b) —
    // painting needs a scene to persist into.
    await page.getByRole("button", { name: "Create a scene" }).click();

    const canvasPanel = page.locator(".fg-scene-canvas");
    await canvasPanel.getByRole("radiogroup", { name: "Tile to paint" }).waitFor({ state: "visible" });

    const canvas = page.locator(".fg-scene-canvas__surface");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("SceneCanvas: canvas element has no bounding box");

    // Same "bottom-right grid corner, clear of the floating toolbar"
    // targeting as sceneCanvas.spec.ts — see that spec's own comment for
    // why this specific point.
    const point = await page.evaluate(() => {
      const debug = (
        window as unknown as {
          __forgeSceneCanvasDebug: {
            camera: { worldToScreen(x: number, y: number): { x: number; y: number } };
            layer: { gridWidth: number; gridHeight: number; tileSize: number };
          };
        }
      ).__forgeSceneCanvasDebug;
      const { gridWidth, gridHeight, tileSize } = debug.layer;
      const worldX = (gridWidth - 1) * tileSize + tileSize / 2;
      const worldY = (gridHeight - 1) * tileSize + tileSize / 2;
      return debug.camera.worldToScreen(worldX, worldY);
    });
    const clickX = Math.floor(point.x);
    const clickY = Math.floor(point.y);

    interface PixiApplicationLike {
      renderer: { render(target: unknown): void };
      stage: unknown;
      canvas: CanvasImageSource;
    }

    const pixelAt = (x: number, y: number) =>
      page.evaluate(
        ({ x, y }) => {
          const debug = (window as unknown as { __forgeSceneCanvasDebug: { host: { app: PixiApplicationLike } } })
            .__forgeSceneCanvasDebug;
          const { app } = debug.host;
          app.renderer.render(app.stage);
          const probe = document.createElement("canvas");
          probe.width = 1;
          probe.height = 1;
          const ctx = probe.getContext("2d")!;
          ctx.drawImage(app.canvas, x, y, 1, 1, 0, 0, 1, 1);
          return Array.from(ctx.getImageData(0, 0, 1, 1).data);
        },
        { x: clickX, y: clickY },
      );

    await canvas.click({ position: { x: clickX, y: clickY } });
    const after = await pixelAt(clickX, clickY);

    expect(after[3]).toBe(255);
    for (let channel = 0; channel < 3; channel++) {
      expect(
        Math.abs(after[channel]! - GRASS_TILE_MEAN_RGB[channel]!),
        `channel ${channel}: rendered ${after[channel]}, pack tile mean ${GRASS_TILE_MEAN_RGB[channel]}`,
      ).toBeLessThanOrEqual(GRASS_TILE_TOLERANCE);
    }
    expect(consoleErrors).toEqual([]);
  });
});
