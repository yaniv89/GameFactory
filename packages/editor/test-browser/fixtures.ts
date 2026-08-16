import { test as base } from "@playwright/test";

/**
 * Every spec in this directory predates the auth/project wiring
 * (`src/main.tsx`'s `AuthGate`/`ProjectsListView`) and runs with no
 * `Forge.Api` backend at all — `playwright.config.ts`'s `webServer` is
 * just the Vite dev server. Without this, `page.goto("/")` would land on
 * the sign-in form (nothing to authenticate against) instead of the
 * editor shell these specs actually test.
 *
 * `addInitScript` runs before any of the page's own scripts on every
 * navigation in this context, so the flag is set before `main.tsx` ever
 * reads it — `src/main.tsx`'s own doc comment on `__FORGE_E2E_SKIP_AUTH__`
 * has the production-safety half of this (dead-code-eliminated outside
 * `import.meta.env.DEV`).
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => {
      window.__FORGE_E2E_SKIP_AUTH__ = true;
    });
    await use(page);
  },
});

export { expect } from "@playwright/test";
