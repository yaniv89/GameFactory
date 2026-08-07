import { expect, test } from "@playwright/test";

/**
 * The one claim in SceneCanvas.tsx that jsdom cannot check (verified: the
 * jsdom Vitest suite's SceneCanvas genuinely lands in its "error" state —
 * "No available renderer for the current environment" — proving that path
 * is real, not a false pass): a real browser actually grants a working
 * WebGPU/WebGL2 renderer and paint tool writes real pixels, not just
 * mutates in-memory state that never reaches the screen. Same reasoning
 * and pixel-extraction technique as packages/render-2d's own real-browser
 * test, reached here through the dev-only `__forgeSceneCanvasDebug` hook
 * since the renderer is created by a live React component, not inline in
 * the test.
 */
test.describe("SceneCanvas, in a real browser", () => {
  test("boots a GPU-backed renderer and a click actually paints the clicked pixel", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/");
    const canvasPanel = page.locator(".fg-scene-canvas");
    await canvasPanel.getByRole("radiogroup", { name: "Tile to paint" }).waitFor({ state: "visible" });
    // Scoped to the canvas panel, not the whole page — dockview itself
    // renders an unrelated empty aria-live role="alert" region for its own
    // tab-focus announcements ("Inspector opened"), found the hard way
    // (this assertion originally queried the whole page and failed on
    // that region, not on anything SceneCanvas rendered).
    await expect(canvasPanel.getByRole("alert")).toHaveCount(0);

    const canvas = page.locator(".fg-scene-canvas__surface");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("SceneCanvas: canvas element has no bounding box");

    // Not the panel's literal center: the camera fits the whole 20x15 grid
    // into the canvas on boot, and at the default docked panel's aspect
    // ratio that letterboxes the grid horizontally (only the visible
    // grid's own screen rect is paintable, which is narrower than the
    // panel) while the floating tool toolbar + tile palette
    // (.fg-scene-canvas__controls) sits over the canvas's top-left corner
    // and, at this panel size, covers most of that letterboxed strip's
    // height too. The grid's own bottom-right corner tile is the one
    // point guaranteed to be both inside the grid and below that chrome.
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

    // Minimal shape of what's actually used — declared here (not imported)
    // since this callback runs inside page.evaluate() in the browser and
    // can't reach across to @forge/render-2d's real types.
    interface PixiApplicationLike {
      renderer: { render(target: unknown): void };
      stage: unknown;
      canvas: CanvasImageSource;
    }

    // Reads the real, currently-displayed pixel at (x, y) by drawing the
    // live <canvas> onto a scratch 1x1 canvas — not Pixi's own
    // extract.pixels(), which scopes to the *target's own content bounds*
    // (e.g. the whole tilemap's world-space extent), not the visible
    // viewport, so its buffer dimensions don't line up with on-screen
    // click coordinates the way this direct approach does.
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

    const before = await pixelAt(clickX, clickY);
    await canvas.click({ position: { x: clickX, y: clickY } });
    const after = await pixelAt(clickX, clickY);

    expect(after).not.toEqual(before);
    // The default-selected palette entry is "Grass" (0x4a7c3c), fully opaque.
    expect(after).toEqual([74, 124, 60, 255]);
    expect(consoleErrors).toEqual([]);
  });
});
