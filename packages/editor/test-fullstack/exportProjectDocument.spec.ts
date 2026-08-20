import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect, test, type Page } from "@playwright/test";

/**
 * Closes the real gap docs/adr/0009 exists to close: M6's exit criterion
 * ("a complete 15-minute RPG ... exported to file://") was previously
 * only ever proven against `fixtures/projects/starter-rpg/project.json`,
 * a hand-authored `ExportProjectInput` file — never a game a creator
 * actually built in the editor, because nothing converted the editor's
 * own `ProjectDocument` into that shape (`packages/cli/src/commands/export.ts`'s
 * own former doc comment said so plainly: "there is no serializer from
 * that to a file yet").
 *
 * This test is the whole loop, for real: sign up against the real
 * `Forge.Api` (`test-fullstack/signupToSave.spec.ts`'s own fixture),
 * build a scene through the real editor UI (same tile-painting mechanics
 * `test-browser/walkableDemo.spec.ts` proves), click "Export Project" to
 * download a real `ProjectDocumentExportFile`, feed that exact downloaded
 * file into the real `forge export --document` CLI (a subprocess of the
 * real compiled `packages/cli/dist/index.js`, not an in-process call),
 * and load the result from a genuine `file://` URL in a fresh browser
 * context — proving a genuinely editor-built project is playable end to
 * end, the way `packages/player/test-browser/exportedGame.spec.ts`
 * already proves for the hand-authored fixture.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const CLI_ENTRY = join(REPO_ROOT, "packages", "cli", "dist", "index.js");

const TILE_SIZE = 32;
const PLAYER_START = { x: 3, y: 8 };
const NPC_TILE = { x: 8, y: 8 };
const DIALOGUE = { speaker: "Innkeeper", text: "Rooms are two gold a night." };

function tileWorldCenter(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX * TILE_SIZE + TILE_SIZE / 2, y: tileY * TILE_SIZE + TILE_SIZE / 2 };
}

async function screenPointForTile(page: Page, tileX: number, tileY: number): Promise<{ x: number; y: number }> {
  const canvas = page.locator(".fg-scene-canvas__surface");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("SceneCanvas surface has no bounding box");
  const world = tileWorldCenter(tileX, tileY);
  const screen = await page.evaluate(
    ([wx, wy]: [number, number]) => {
      const debug = (window as unknown as { __forgeSceneCanvasDebug: { camera: { worldToScreen(x: number, y: number): { x: number; y: number } } } })
        .__forgeSceneCanvasDebug;
      return debug.camera.worldToScreen(wx, wy);
    },
    [world.x, world.y] as [number, number],
  );
  return { x: box.x + screen.x, y: box.y + screen.y };
}

async function clickTile(page: Page, tileX: number, tileY: number): Promise<void> {
  const point = await screenPointForTile(page, tileX, tileY);
  await page.mouse.click(point.x, point.y);
}

test.describe("docs/adr/0009: a real editor-built project exported and played over file://", () => {
  test("build a scene through the real editor UI, export it, run the real CLI, and play the real file:// output", async ({ page }) => {
    test.setTimeout(90_000); // signup + UI build + a real vite build subprocess + a fresh file:// page — see packages/player/playwright.config.ts's own 60s for the CLI-build half alone.

    const email = `e2e+export+${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const password = "correct horse battery staple 42";
    const projectTitle = `Export E2E ${Date.now()}`;

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Sign in to Forge" })).toBeVisible();

    await page.getByRole("button", { name: /need an account\? create one/i }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Display name").fill("Export E2E Tester");
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();

    await expect(page.getByRole("region", { name: "Your projects" })).toBeVisible({ timeout: 15000 });
    await page.getByLabel("New project name").fill(projectTitle);
    await page.getByRole("button", { name: "Create project" }).click();
    await expect(page.getByText(projectTitle)).toBeVisible({ timeout: 10000 });

    // Build a real, minimal scene through the real UI — a player start and
    // one NPC with a real, human-typed dialogue line. No walls needed:
    // walkableDemo.spec.ts already proves collision; this test's job is
    // proving the export pipeline carries a real project through intact.
    await page.getByRole("button", { name: "Create a scene" }).click();
    await expect(page.getByRole("treeitem", { name: "Scene 1" })).toBeVisible();

    await page.getByRole("radio", { name: "Player start" }).waitFor({ state: "visible" });
    await page.getByRole("radio", { name: "Player start" }).click();
    await clickTile(page, PLAYER_START.x, PLAYER_START.y);

    await page.getByRole("radio", { name: "NPC" }).click();
    await clickTile(page, NPC_TILE.x, NPC_TILE.y);

    const speakerField = page.getByLabel("Speaker");
    await expect(speakerField).toBeVisible();
    await speakerField.fill(DIALOGUE.speaker);
    const lineField = page.getByLabel("Line");
    await lineField.fill(DIALOGUE.text);
    await lineField.blur();

    // Install @forge/dialogue — without it, the NPC's line was authored
    // but nothing would carry it into the exported module config
    // (docs/adr/0009's dialogue adapter only fires for an installed
    // module; ProjectDocument.installedModules is the install flag).
    const dialogueRow = page.locator("li.fg-modules-list__row", { hasText: "@forge/dialogue" });
    await dialogueRow.getByRole("button", { name: "Install" }).click();

    // The download is the whole point of this button — capture it rather
    // than just asserting the click didn't throw.
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "Export Project" }).click(),
    ]);
    const downloadedDocPath = join(mkdtempSync(join(tmpdir(), "forge-export-doc-")), "project.json");
    await download.saveAs(downloadedDocPath);

    // The real CLI, as a real subprocess of its real compiled entry
    // point — not an in-process call to runExport — same rigor
    // exportedGame.spec.ts already applies to the --project path.
    const outDir = mkdtempSync(join(tmpdir(), "forge-export-e2e-out-"));
    execFileSync("node", [CLI_ENTRY, "export", "--document", downloadedDocPath, "--out", outDir], {
      stdio: "inherit",
    });

    // A fresh browser context for the file:// load — this is a genuinely
    // different origin/security context from the editor's own http://
    // localhost:5190 page above, exactly what "no dev server, no network"
    // is supposed to mean.
    const browser = await chromium.launch();
    const filePage = await browser.newPage();
    const consoleErrors: string[] = [];
    const externalRequests: string[] = [];
    filePage.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    filePage.on("pageerror", (err) => consoleErrors.push(err.message));
    filePage.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("http://") || url.startsWith("https://")) externalRequests.push(url);
    });

    await filePage.goto(pathToFileURL(join(outDir, "index.html")).href);
    await expect(filePage.locator("#forge-player-canvas")).toBeVisible();
    await filePage.waitForTimeout(1000); // QuickJS WASM instantiation + first render tick, same as exportedGame.spec.ts

    const MOVE_SPEED = 140; // packages/player/src/gameWorld.ts MOVE_SPEED
    const SAFETY_MARGIN_TILES = 0.3;
    const travelMs = (tiles: number) => Math.round((Math.max(tiles - SAFETY_MARGIN_TILES, 0) * TILE_SIZE * 1000) / MOVE_SPEED);

    await filePage.keyboard.down("ArrowRight");
    await filePage.waitForTimeout(travelMs(NPC_TILE.x - PLAYER_START.x));
    await filePage.keyboard.up("ArrowRight");
    await filePage.waitForTimeout(200);

    await filePage.keyboard.press("e");
    const bubble = filePage.locator("#forge-player-dialogue");
    await expect(bubble).toBeVisible({ timeout: 5000 });
    await expect(filePage.locator("#forge-player-dialogue-speaker")).toHaveText(DIALOGUE.speaker);
    await expect(filePage.locator("#forge-player-dialogue-text")).toHaveText(DIALOGUE.text);

    expect(consoleErrors).toEqual([]);
    expect(externalRequests).toEqual([]);

    await browser.close();
    rmSync(dirname(downloadedDocPath), { recursive: true, force: true });
    rmSync(outDir, { recursive: true, force: true });
  });
});
