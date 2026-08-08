import { expect, test } from "@playwright/test";

const PERSIST_KEY = "forge:editor:project-document";
const PERSIST_VERSION = 2;
const FIXTURE_PACK_NAME = "@forge-fixtures/starter-pack";

/**
 * docs/SPEC.md Section 11.4's asset resolution, proven in a real
 * browser: with fixtures/packs/starter-pack active, painting "Grass"
 * must produce that pack's own tile color (34, 139, 34) — deliberately
 * chosen distinct from tilePalette.ts's flat-color default (74, 124, 60,
 * verified passing in sceneCanvas.spec.ts) specifically so a passing
 * pixel assertion here can only mean the real PNG was fetched and
 * sliced, not that the fallback happened to look plausible.
 */
test.describe("Art Pack rendering, in a real browser", () => {
  test("with a pack active, painting Grass renders that pack's own tile color, not the flat-color fallback", async ({ page }) => {
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

    // fixtures/packs/starter-pack/tilesets/outdoor-base.png's grass
    // column — not tilePalette.ts's flat 0x4a7c3c (74, 124, 60).
    expect(after).toEqual([34, 139, 34, 255]);
    expect(consoleErrors).toEqual([]);
  });
});
