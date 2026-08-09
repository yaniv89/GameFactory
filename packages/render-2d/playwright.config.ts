import { existsSync } from "node:fs";
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
 *
 * `PLAYWRIGHT_CHROMIUM_PATH`, if set, always wins. Otherwise this sandbox
 * ships a pre-installed Chromium at a fixed path — used when present. On a
 * CI runner that path doesn't exist, so `executablePath` is left undefined
 * and Playwright falls back to its own managed browser (installed via
 * `playwright install chromium` in CI, see .github/workflows/ci.yml). A
 * hardcoded sandbox-only path with no fallback would work here and then
 * silently break the first time this ran anywhere else.
 */
const SANDBOX_CHROMIUM_PATH = "/opt/pw-browsers/chromium";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync(SANDBOX_CHROMIUM_PATH) ? SANDBOX_CHROMIUM_PATH : undefined);

export default defineConfig({
  testDir: "./test-browser",
  fullyParallel: true,
  reporter: "list",
  use: {
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: ["--js-flags=--expose-gc"],
    },
  },
  projects: [{ name: "chromium" }],
});
