import { defineConfig } from "@playwright/test";

/**
 * @forge/render-2d's Vitest suite (test/) exercises Camera, TilemapLayer,
 * and the ECS sync systems against duck-typed fakes shaped to match Pixi's
 * real Sprite/Container API, so it runs in plain Node. What it cannot
 * prove is whether a real browser actually grants a WebGPU or WebGL2
 * context under our exact `RenderHost` init options (`preference:
 * ['webgpu', 'webgl']`) — Pixi's own default preference order is
 * `['webgl', 'webgpu', 'canvas']`, so this is the one claim in
 * `renderHost.ts` that isn't just a type-check. These specs (test-browser/)
 * run the real `pixi.js` browser bundle in headless Chromium to check it.
 */
export default defineConfig({
  testDir: "./test-browser",
  fullyParallel: true,
  reporter: "list",
  use: {
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
    },
  },
  projects: [{ name: "chromium" }],
});
