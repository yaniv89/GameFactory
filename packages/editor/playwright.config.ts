import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/**
 * Vitest + jsdom (src/*.test.tsx) proves the shell's own logic, but jsdom
 * has no WebGL/WebGPU — SceneCanvas correctly lands in its "error" state
 * there (verified: App.test.tsx's console output shows the real "No
 * available renderer" failure path firing, not a false pass). Whether the
 * canvas actually boots a GPU-backed renderer and paints tiles can only be
 * checked in a real browser — same reasoning as
 * packages/render-2d/playwright.config.ts, extended here to run against
 * the real Vite dev server (not a static bundle) since SceneCanvas's
 * test-only debug hook only exists under `import.meta.env.DEV`.
 */
const SANDBOX_CHROMIUM_PATH = "/opt/pw-browsers/chromium";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync(SANDBOX_CHROMIUM_PATH) ? SANDBOX_CHROMIUM_PATH : undefined);

const PORT = 5190;

export default defineConfig({
  testDir: "./test-browser",
  fullyParallel: true,
  reporter: "list",
  // A little above Playwright's 30s default: a completely cold Vite dev
  // server (no node_modules/.vite cache yet) pays a one-time dependency
  // pre-bundling cost for pixi.js's large dependency graph on its first
  // page load. Warm runs consistently finish this whole spec in ~2-4s
  // (verified with repeated runs), so this is slack for that one cold
  // case, not a sign the spec itself is normally slow.
  timeout: 45_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
    },
  },
  webServer: {
    command: `pnpm exec vite --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [{ name: "chromium" }],
});
