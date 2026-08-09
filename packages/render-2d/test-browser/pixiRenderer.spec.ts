import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// pixi.js's package.json "exports" map doesn't publish "./dist/*" (or even
// "./package.json") as a resolvable subpath, so the dist bundle is located
// relative to the main entry point's directory (lib/index.js) rather than
// via `require.resolve("pixi.js/dist/...")`.
const require = createRequire(import.meta.url);
const pixiMainEntry = require.resolve("pixi.js");
const pixiPackageRoot = dirname(dirname(pixiMainEntry)); // .../pixi.js/lib/index.js -> .../pixi.js
const pixiGlobalScriptPath = join(pixiPackageRoot, "dist/pixi.min.js");

/**
 * `renderHost.ts` explicitly overrides Pixi's own renderer preference
 * order (`['webgl', 'webgpu', 'canvas']`) to `['webgpu', 'webgl']` per
 * CLAUDE.md Section 2.3 / docs/SPEC.md Section 8.1's "WebGPU with WebGL2
 * fallback." That override, and whether a GPU-backed renderer is even
 * obtainable at all in a headless Chromium, can only be checked against a
 * real browser — this file loads Pixi's actual browser bundle (not our
 * compiled TS, which needs a bundler this package doesn't own yet — see
 * the Phase 3 report) and drives the same init options `RenderHost` uses.
 */
test.describe("RenderHost's real Pixi init options, in a real browser", () => {
  test("boots a GPU-backed renderer, batches a sprite draw, and produces non-blank pixel output", async ({
    page,
  }) => {
    await page.goto("about:blank");
    await page.addScriptTag({ path: pixiGlobalScriptPath });

    const result = await page.evaluate(async () => {
      const PIXI = (window as unknown as { PIXI: typeof import("pixi.js") }).PIXI;

      const app = new PIXI.Application();
      await app.init({
        width: 64,
        height: 64,
        backgroundColor: 0x000000,
        preference: ["webgpu", "webgl"],
        antialias: false,
        resolution: 1,
        autoDensity: false,
      });

      const worldContainer = new PIXI.Container({ label: "world" });
      app.stage.addChild(worldContainer);

      const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
      sprite.tint = 0xff0000;
      sprite.width = 32;
      sprite.height = 32;
      sprite.position.set(16, 16);
      worldContainer.addChild(sprite);

      app.renderer.render(app.stage);

      // Extracting from the stage (not the sprite directly) captures the
      // actual rendered/transformed composition; Pixi's extract-by-display-
      // object path returns the object's native texture bounds instead
      // (1x1 for `Texture.WHITE`), which isn't what this test is checking.
      const extracted = app.renderer.extract.pixels(app.stage);
      const canvasTag = app.canvas.tagName;
      const rendererType = app.renderer.type;

      app.destroy(true, { children: true, texture: true });

      return {
        canvasTag,
        rendererType,
        pixelWidth: extracted.width,
        pixelHeight: extracted.height,
        firstPixel: Array.from(extracted.pixels.slice(0, 4)),
      };
    });

    expect(result.canvasTag).toBe("CANVAS");
    // RendererType: WEBGL = 1, WEBGPU = 2. Either is an acceptable outcome of the
    // ['webgpu', 'webgl'] preference — which one Chromium actually grants
    // depends on the host's GPU support, not on this test.
    expect([1, 2]).toContain(result.rendererType);
    expect(result.pixelWidth).toBeGreaterThan(0);
    expect(result.pixelHeight).toBeGreaterThan(0);
    // A red, fully-opaque, un-antialiased sprite: the extracted pixel must
    // actually be red, not the canvas's black background or a blank buffer.
    expect(result.firstPixel).toEqual([255, 0, 0, 255]);
  });

  test("excluding webgpu/webgl from preference (canvas-only) still yields a working 2D fallback", async ({
    page,
  }) => {
    await page.goto("about:blank");
    await page.addScriptTag({ path: pixiGlobalScriptPath });

    const rendererType = await page.evaluate(async () => {
      const PIXI = (window as unknown as { PIXI: typeof import("pixi.js") }).PIXI;
      const app = new PIXI.Application();
      await app.init({ width: 16, height: 16, preference: ["canvas"] });
      const type = app.renderer.type;
      app.destroy(true, { children: true, texture: true });
      return type;
    });

    // RendererType.CANVAS = 4 — sanity check that our test harness can tell
    // renderer kinds apart at all, rather than every run coincidentally
    // reporting the same number.
    expect(rendererType).toBe(4);
  });
});
