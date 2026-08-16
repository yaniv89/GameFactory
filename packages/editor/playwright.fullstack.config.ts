import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

/**
 * `test-fullstack/`'s own config, separate from `playwright.config.ts`
 * (`test-browser/`'s): that suite deliberately runs against a bare `vite`
 * dev server with no `Forge.Api` at all and bypasses auth
 * (`__FORGE_E2E_SKIP_AUTH__`) specifically so canvas/rendering tests don't
 * need a backend — this suite is the opposite, and needs one on purpose.
 *
 * No `webServer` block: unlike `test-browser/`'s config, this suite can't
 * just spawn `vite` and go — `Forge.Api` needs Postgres/Redis/Azurite up
 * first, and its own startup (schema bootstrap + OpenIddict seeding) takes
 * longer than a dev server. The caller (`README.md`'s "Running the full
 * stack locally", or `full-stack-e2e` in `.github/workflows/ci.yml`) is
 * responsible for having both `Forge.Api` (5080) and `vite` (5190) already
 * up and healthy before running this config — explicit orchestration,
 * not a magic auto-start that hides exactly the kind of ordering bug this
 * suite exists to catch.
 */
const SANDBOX_CHROMIUM_PATH = "/opt/pw-browsers/chromium";
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync(SANDBOX_CHROMIUM_PATH) ? SANDBOX_CHROMIUM_PATH : undefined);

const PORT = 5190;

export default defineConfig({
  testDir: "./test-fullstack",
  fullyParallel: false, // each test signs up a brand-new account against a shared, stateful backend — no benefit to parallelizing yet, and it'd complicate failure triage for no reason.
  reporter: "list",
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
    },
  },
  projects: [{ name: "chromium" }],
});
