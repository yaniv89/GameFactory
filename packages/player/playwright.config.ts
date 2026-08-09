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
  fullyParallel: true,
  reporter: "list",
  timeout: 60_000,
  use: {
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
    },
  },
  projects: [{ name: "chromium" }],
});
