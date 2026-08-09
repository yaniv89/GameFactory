import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

/**
 * The M6 exit criterion, mechanically: "a complete 15-minute RPG
 * published to a URL and exported to file:// with no network access"
 * (CLAUDE.md). This runs the real `forge export` CLI (packages/cli's own
 * compiled dist/index.js, not a mock) against the real, checked-in
 * fixtures/projects/starter-rpg/project.json, opens the real output
 * index.html from a genuine file:// URL — no dev server, no `webServer`
 * config, see playwright.config.ts's own doc comment — and plays it:
 * walks the player through the doorway to the NPC and talks to it,
 * watching the whole time for any http(s) network request (the actual
 * "no network access" claim) or console/page error.
 *
 * What this does not prove: the "15-minute RPG" / "published to a URL"
 * halves of the exit criterion — publish-to-a-URL is M6 Phase 6's own
 * package-registry-backed hosting path (already covered by that phase's
 * own tests), and "15 minutes" is a size/complexity claim about a real
 * project, not a mechanical one this fixture (two rooms, one NPC) is
 * sized to demonstrate. This test's scope is the file:// export half.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const CLI_ENTRY = join(REPO_ROOT, "packages", "cli", "dist", "index.js");
const STARTER_RPG_PROJECT = join(REPO_ROOT, "fixtures", "projects", "starter-rpg", "project.json");

// Matches fixtures/projects/starter-rpg/project.json exactly — the same
// two-room-plus-doorway layout packages/editor/test-browser/walkableDemo.spec.ts
// already proves walkable through the real editor UI.
const TILE_SIZE = 32;
const MOVE_SPEED = 140; // world units/sec — packages/player/src/gameWorld.ts MOVE_SPEED
const PLAYER_START = { x: 3, y: 11 };
const DOORWAY_TILE = { x: 10, y: 7 };
const NPC_TILE = { x: 16, y: 7 };
const DIALOGUE = { speaker: "Shopkeeper", text: "Welcome to my shop!" };

// Slightly less than the exact tile-distance travel time, so a hold lands
// the player inside the target tile's 32-unit window rather than right on
// its boundary (where floating-point/frame-timing jitter could tip it
// into the next tile over).
const SAFETY_MARGIN_TILES = 0.3;

/** Milliseconds to hold a direction key to cover `tiles` tiles at MOVE_SPEED, shaved by SAFETY_MARGIN_TILES. */
function travelMs(tiles: number): number {
  return Math.round((Math.max(tiles - SAFETY_MARGIN_TILES, 0) * TILE_SIZE * 1000) / MOVE_SPEED);
}

let outDir: string;

test.beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "forge-player-e2e-"));
  // A real subprocess run of the real CLI entry point — not an in-process
  // import of runExport, so this also proves `forge export` works the way
  // an actual creator would invoke it (packages/cli's own bin script).
  execFileSync("node", [CLI_ENTRY, "export", "--project", STARTER_RPG_PROJECT, "--out", outDir], {
    stdio: "inherit",
  });
});

test.afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

test.describe("M6 exit criterion: forge export to a real file:// build", () => {
  test("loads with zero network requests, and a real player can walk to the NPC and talk to it", async ({ page }) => {
    const consoleErrors: string[] = [];
    const externalRequests: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("http://") || url.startsWith("https://")) externalRequests.push(url);
    });

    const indexUrl = pathToFileURL(join(outDir, "index.html")).href;
    await page.goto(indexUrl);

    const canvas = page.locator("#forge-player-canvas");
    await expect(canvas).toBeVisible();

    // No debug hook exists in this production build (render.ts's own
    // __forgePlayerDebug is DEV-gated and stripped — deliberately, see
    // that file's doc comment), so unlike walkableDemo.spec.ts's polling
    // against a live transform, movement here is time-based: hold a key
    // for slightly less than the exact travel time for N tiles, which
    // keeps the player inside the target tile's 32-unit window rather
    // than at its boundary. A short settle pause after each release gives
    // the fixed-step scheduler a moment to apply the final frames before
    // the next input starts.
    await page.waitForTimeout(1000); // let QuickJS WASM instantiation + the first render tick actually finish before driving input

    // 1. Walk up from the player start to the doorway row's y — well clear
    //    of the wall column (x=10) the whole way (player x stays at 3).
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(travelMs(PLAYER_START.y - DOORWAY_TILE.y));
    await page.keyboard.up("ArrowUp");
    await page.waitForTimeout(200);

    // 2. Walk right through the doorway gap to the NPC.
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(travelMs(NPC_TILE.x - PLAYER_START.x));
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(200);

    // 3. Interact — the NPC's real, configured dialogue line should
    //    appear in the dialogue bubble main.ts wires up to the real
    //    "dialogue:shown" event from the sandboxed @forge/dialogue module.
    await page.keyboard.press("e");
    const bubble = page.locator("#forge-player-dialogue");
    await expect(bubble).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("#forge-player-dialogue-speaker")).toHaveText(DIALOGUE.speaker);
    await expect(page.locator("#forge-player-dialogue-text")).toHaveText(DIALOGUE.text);

    expect(consoleErrors).toEqual([]);
    expect(externalRequests).toEqual([]);
  });
});
