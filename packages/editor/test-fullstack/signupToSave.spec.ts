import { expect, test } from "@playwright/test";

/**
 * The one suite in this repo that drives the editor against a real
 * `Forge.Api` — Postgres, Redis, Azurite, the real OpenIddict server —
 * instead of a bare `vite` dev server with auth bypassed
 * (`test-browser/`'s own fixture). `playwright.fullstack.config.ts`'s own
 * doc comment explains why this is a separate suite/config rather than a
 * flag on the existing one.
 *
 * This exists because two real bugs (a StrictMode double-invoke that
 * broke every sign-up, and a missing dev-proxy `changeOrigin` that broke
 * every collab connection) shipped past CI and were only found by an
 * actual manual run against the real stack — this suite is that manual
 * run, automated, so the next one is caught here instead.
 */
test.describe("Full stack: sign up, create a project, save, see presence", () => {
  test("a brand-new account can sign up, land on an empty project list, create a project, paint a scene, save it for real, and see itself as an online collaborator", async ({ page }) => {
    const email = `e2e+${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const password = "correct horse battery staple 42";
    const projectTitle = `E2E Game ${Date.now()}`;

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in to Forge" })).toBeVisible();

    await page.getByRole("button", { name: /need an account\? create one/i }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Display name").fill("E2E Tester");
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    // The real Authorization Code + PKCE round trip: POST /api/v1/auth/login
    // establishes the Identity cookie, a real browser navigation to
    // /connect/authorize (auto-approved), redirected to /auth/callback with
    // a real code, exchanged via /connect/token, landing back on "/".
    await expect(page.getByRole("region", { name: "Your projects" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText("No projects yet")).toBeVisible();

    await page.getByLabel("New project name").fill(projectTitle);
    await page.getByRole("button", { name: "Create project" }).click();

    // A brand-new project has no revisions yet — GetDocumentEndpoint 404s
    // and the editor starts from a blank document, not an error state.
    await expect(page.getByText(projectTitle)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();

    await page.getByRole("button", { name: "Create a scene" }).click();
    await expect(page.getByRole("treeitem", { name: "Scene 1" })).toBeVisible();

    await page.getByRole("button", { name: "Save" }).click();
    // Never optimistic (CLAUDE.md 5.3) — this only appears once the server
    // has actually confirmed the commit.
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({ timeout: 10000 });

    // Live presence: a real SignalR connection to CollabHub, authenticated
    // with the same Bearer token every REST call uses. This is exactly the
    // path the missing dev-proxy changeOrigin broke — it never surfaced in
    // any other check because nothing else exercises /hubs/collab/negotiate.
    await expect(page.getByText("1 online")).toBeVisible({ timeout: 10000 });

    // The save really persisted server-side, not just in memory: reload the
    // page (which also drops the in-memory-only session by design — see
    // authClient.ts's own doc comment) and sign back in to the same
    // account, confirming the project is still there with its scene.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sign in to Forge" })).toBeVisible();

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("region", { name: "Your projects" })).toBeVisible({ timeout: 15000 });
    await page.getByText(projectTitle).click();
    await expect(page.getByRole("treeitem", { name: "Scene 1" })).toBeVisible({ timeout: 10000 });
  });
});
