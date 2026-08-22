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
  // K1 Phase 2b originally forced `workers: 1` here: `forge export`
  // (packages/cli/src/commands/export.ts) builds through the one shared
  // `packages/player/dist-app/` intermediate directory, and two spec
  // files in this directory each call it from their own `beforeAll` —
  // confirmed colliding the hard way, adding packArtRendering.spec.ts
  // alongside exportedGame.spec.ts under `fullyParallel: true`. #183
  // fixed the actual root cause instead of just working around it here:
  // `runExport` now holds a real cross-process lock
  // (packages/cli/src/exportLock.ts) around that whole shared-tree
  // sequence, so concurrent `forge export` invocations serialize safely
  // no matter who's calling them — this config no longer needs to.
  reporter: "list",
  timeout: 60_000,
  use: {
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
    },
  },
  projects: [{ name: "chromium" }],
});
