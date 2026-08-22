import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/**
 * Tests a real `forge export` output loaded from a genuine `file://` URL
 * — no dev server, no `webServer` config, on purpose: docs/SPEC.md
 * Section 15.3's whole claim is that the exported build needs neither.
 * Same executablePath fallback as packages/render-2d/playwright.config.ts
 * and packages/editor/playwright.config.ts.
 */
const SANDBOX_CHROMIUM_PATH = "/opt/pw-browsers/chromium";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync(SANDBOX_CHROMIUM_PATH) ? SANDBOX_CHROMIUM_PATH : undefined);

export default defineConfig({
  testDir: "./test-browser",
  // K1 Phase 2b: `forge export` (packages/cli/src/commands/export.ts)
  // always builds through the one shared `packages/player/dist-app/`
  // intermediate directory before copying to a spec's own `--out` — real
  // for any two concurrent exports against one checkout, not just tests,
  // but this is the one place it can actually collide: two spec files in
  // this directory each call it from their own `beforeAll`. Confirmed the
  // hard way, adding packArtRendering.spec.ts alongside the existing
  // exportedGame.spec.ts: `fullyParallel: true` ran both exports at once
  // and one process's `vite build` deleted `dist-app/`'s inlined JS out
  // from under the other's own inline-bundle.mjs step. `workers: 1` is
  // the honest fix at this layer — making concurrent `forge export`
  // itself safe (a per-invocation build directory) is a real, separate
  // improvement to packages/cli, out of scope here.
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
    },
  },
  projects: [{ name: "chromium" }],
});
