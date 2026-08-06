import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pixiMainEntry = require.resolve("pixi.js");
const pixiPackageRoot = dirname(dirname(pixiMainEntry));
const pixiGlobalScriptPath = join(pixiPackageRoot, "dist/pixi.min.js");

/**
 * Render-side half of the M1 exit criterion ("5000 entities at 60fps
 * reference desktop, 1000 at 60fps Pixel 6a") — `packages/core`'s
 * `bench/simulation.bench.ts` and `test/steady-state-heap.test.ts` cover
 * the ECS/collision simulation cost; this covers what real Pixi rendering
 * of that many sprites actually costs, since that's additive on top.
 *
 * ⚠ Two honesty caveats, same spirit as pixiRenderer.spec.ts:
 * 1. This exercises the real `pixi.js` browser bundle directly, not our
 *    `SpriteSync`/`TilemapLayer` TS classes — those still need a bundler
 *    to run unbundled in a browser (tracked since Phase 3). Position
 *    updates here are a plain in-page JS loop standing in for what
 *    SpriteSync would do.
 * 2. This sandbox has no WebGPU (Phase 3 found WebGL is what's actually
 *    granted here), and headless Chromium's WebGL is very likely
 *    software-rendered (no real GPU passthrough) — so these numbers are
 *    neither "reference desktop" nor "Pixel 6a" from Section 18.3, and
 *    are probably *worse* than either. They're a regression baseline for
 *    this sandbox, not a budget sign-off.
 */

interface RenderRunResult {
  avgFrameMs: number;
  p95FrameMs: number;
  heapGrowthBytes: number;
}

async function runRenderBenchmark(page: import("@playwright/test").Page, spriteCount: number): Promise<RenderRunResult> {
  return page.evaluate(async (count) => {
    const PIXI = (window as unknown as { PIXI: typeof import("pixi.js") }).PIXI;
    const gc = (window as unknown as { gc?: () => void }).gc;
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;

    const app = new PIXI.Application();
    await app.init({
      width: 960,
      height: 540,
      backgroundColor: 0x000000,
      preference: ["webgpu", "webgl"],
      antialias: false,
      resolution: 1,
      autoDensity: false,
    });

    const worldContainer = new PIXI.Container({ label: "world" });
    app.stage.addChild(worldContainer);

    const columns = Math.ceil(Math.sqrt(count));
    const spacing = 12;
    const worldSize = columns * spacing;

    const sprites: InstanceType<typeof PIXI.Sprite>[] = [];
    const velocities: Array<{ vx: number; vy: number }> = [];
    for (let i = 0; i < count; i++) {
      const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
      sprite.width = 4;
      sprite.height = 4;
      sprite.position.set((i % columns) * spacing, Math.floor(i / columns) * spacing);
      worldContainer.addChild(sprite);
      sprites.push(sprite);
      velocities.push({ vx: ((i % 7) - 3) * 2, vy: ((i % 5) - 2) * 2 });
    }

    function wrap(value: number, size: number): number {
      return ((value % size) + size) % size;
    }

    function stepAndRender(): void {
      for (let i = 0; i < sprites.length; i++) {
        const sprite = sprites[i]!;
        const v = velocities[i]!;
        sprite.position.x = wrap(sprite.position.x + v.vx, worldSize);
        sprite.position.y = wrap(sprite.position.y + v.vy, worldSize);
      }
      app.renderer.render(app.stage);
    }

    const WARMUP_FRAMES = 30;
    const MEASURED_FRAMES = 120;

    for (let i = 0; i < WARMUP_FRAMES; i++) stepAndRender();

    gc?.();
    const heapBefore = memory?.usedJSHeapSize ?? 0;

    const frameTimes: number[] = [];
    for (let i = 0; i < MEASURED_FRAMES; i++) {
      const start = performance.now();
      stepAndRender();
      frameTimes.push(performance.now() - start);
    }

    gc?.();
    const heapAfter = memory?.usedJSHeapSize ?? 0;

    app.destroy(true, { children: true, texture: true });

    frameTimes.sort((a, b) => a - b);
    const avgFrameMs = frameTimes.reduce((sum, t) => sum + t, 0) / frameTimes.length;
    const p95FrameMs = frameTimes[Math.floor(frameTimes.length * 0.95)]!;

    return { avgFrameMs, p95FrameMs, heapGrowthBytes: heapAfter - heapBefore };
  }, spriteCount);
}

test.describe("Render throughput and heap growth at M1's target entity counts", () => {
  for (const spriteCount of [1000, 5000]) {
    test(`${spriteCount} sprites: renders without error and reports frame time + heap growth`, async ({ page }) => {
      await page.goto("about:blank");
      await page.addScriptTag({ path: pixiGlobalScriptPath });

      const result = await runRenderBenchmark(page, spriteCount);

      console.log(
        `renderThroughput[${spriteCount} sprites]: avg=${result.avgFrameMs.toFixed(3)}ms ` +
          `p95=${result.p95FrameMs.toFixed(3)}ms heapGrowth=${(result.heapGrowthBytes / 1024 / 1024).toFixed(2)}MB ` +
          `(this sandbox's software-rendered WebGL — not a Section 18.3 reference device)`,
      );

      expect(result.avgFrameMs).toBeGreaterThan(0);
      // Coarse on purpose: performance.memory is bucketed/quantized by the
      // browser (confirmed in this sandbox — see bench/README.md), so this
      // catches a real "allocates per sprite per frame" regression, not
      // sub-megabyte noise.
      expect(result.heapGrowthBytes).toBeLessThan(50 * 1024 * 1024);
    });
  }
});
