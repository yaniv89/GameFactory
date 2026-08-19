// A real Node script proving bootGameLogic end to end, not vitest — see
// scripts/build-smoke-test.mjs's own doc comment for why (a real
// pnpm supply-chain gate, not a preference). This directory mirrors
// packages/runtime-host/src/smoke's own structure and its tsconfig.json
// exclusion (server/dev tooling, never part of what a player's browser
// downloads) for the same reasons that file documents.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TransformSchema } from "@forge/core";
import { JSDOM } from "jsdom";
import { newQuickJSWASMModuleFromVariant, newVariant, RELEASE_SYNC, type QuickJSWASMModule } from "quickjs-emscripten";
import { renderDialogueRichText } from "../dialogueRichText.js";
import { bootGameLogic } from "../gameLogic.js";
import type { PlayerProjectData } from "../playerProjectData.js";
import { WALL_TILE_ID } from "../tilePalette.js";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));

/** Same technique packages/runtime-host/test/testWasmModule.ts uses (real .wasm bytes off disk, no fetch/XHR) — proven there against the real file:// constraint this package exists to satisfy. */
async function buildWasmModuleFromEmbeddedBytes(): Promise<QuickJSWASMModule> {
  const quickjsEmscriptenPkgJson = require.resolve("quickjs-emscripten/package.json");
  const wasmfilePkgJson = require.resolve("@jitl/quickjs-wasmfile-release-sync/package.json", {
    paths: [dirname(quickjsEmscriptenPkgJson)],
  });
  const wasmPath = join(dirname(wasmfilePkgJson), "dist", "emscripten-module.wasm");
  const wasmBinary = readFileSync(wasmPath);
  const arrayBuffer = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  return newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC, { wasmBinary: arrayBuffer }));
}

function readDialogueGuestBundle(): string {
  const path = require.resolve("@forge/dialogue/dist/guest-bundle.js", { paths: [HERE] });
  return readFileSync(path, "utf8");
}

const GRID_WIDTH = 20;
const GRID_HEIGHT = 15;
const TILE_SIZE = 32;

const SCENE_1_PLAYER_START = { x: 2, y: 2 };
// Deliberately a different cell than scene-1's wall — the "scene:changed"
// assertions below need scene-1's old wall location to stop blocking and
// scene-2's own wall to start, not just "isWalkable returns something".
const SCENE_2_PLAYER_START = { x: 10, y: 10 };

function buildFixtureProjectData(guestBundleSource: string): PlayerProjectData {
  const scene1Tiles = new Array(GRID_WIDTH * GRID_HEIGHT).fill(0);
  // A wall tile directly east of scene-1's player start, so isWalkable
  // actually has something real to block.
  scene1Tiles[SCENE_1_PLAYER_START.y * GRID_WIDTH + (SCENE_1_PLAYER_START.x + 1)] = WALL_TILE_ID;

  const scene2Tiles = new Array(GRID_WIDTH * GRID_HEIGHT).fill(0);
  // Scene-2's own wall, at a cell scene-1 left open — proves isWalkable
  // is reading whichever scene is actually current, not a boot-time copy.
  scene2Tiles[SCENE_2_PLAYER_START.y * GRID_WIDTH + (SCENE_2_PLAYER_START.x + 1)] = WALL_TILE_ID;

  return {
    projectId: "smoke-test-project",
    buildId: "smoke-test-build",
    schemaVersion: 1,
    engineVersion: "0.0.0-smoke-test",
    scenes: [
      {
        id: "scene-1",
        name: "Test Scene",
        tiles: scene1Tiles,
        entities: [
          { id: "player", prefabId: "player-start", tileX: SCENE_1_PLAYER_START.x, tileY: SCENE_1_PLAYER_START.y },
          {
            id: "npc-1",
            prefabId: "npc",
            tileX: SCENE_1_PLAYER_START.x,
            // 4 tiles south = 128 world units — outside gameWorld.ts's
            // INTERACT_RANGE (40) at boot, so "walking into range" is a
            // real state change the test below exercises, not
            // already-true-at-boot.
            tileY: SCENE_1_PLAYER_START.y + 4,
            dialogue: { speaker: "Guard", text: "Halt!" },
          },
        ],
      },
      {
        id: "scene-2",
        name: "Second Scene",
        tiles: scene2Tiles,
        entities: [
          { id: "player-2", prefabId: "player-start", tileX: SCENE_2_PLAYER_START.x, tileY: SCENE_2_PLAYER_START.y },
          {
            id: "npc-2",
            prefabId: "npc",
            tileX: SCENE_2_PLAYER_START.x,
            tileY: SCENE_2_PLAYER_START.y + 4,
            dialogue: { speaker: "Merchant", text: "Welcome!" },
          },
        ],
      },
    ],
    installedModules: [
      {
        name: "@forge/dialogue",
        version: "1.0.0",
        config: {
          trees: [
            { id: "npc-1", nodes: [{ speaker: "Guard", text: "Halt!" }] },
            { id: "npc-2", nodes: [{ speaker: "Merchant", text: "Welcome!" }] },
          ],
        },
        guestBundleSource,
      },
    ],
    startSceneId: "scene-1",
  };
}

/**
 * docs/adr/0011 D2's own DOM renderer, proven against a real `document`
 * (jsdom, not a hand-rolled fake) rather than assumed from the parser
 * tests alone — the load-bearing question here is specifically "does this
 * package's own DOM-building code produce real `<em>`/`<strong>`/`<code>`/
 * `<a>` elements and never a markup string," which packages/richtext's
 * own test suite can't exercise because it has no renderer of its own.
 */
function assertDialogueRichTextRendering(): void {
  const dom = new JSDOM("<!doctype html><div id=\"container\"></div>");
  const container = dom.window.document.querySelector<HTMLDivElement>("#container")!;

  renderDialogueRichText(container, "Rooms are *two gold* a night — see the **innkeeper** for a `key`.");
  assert.equal(container.querySelector("em")?.textContent, "two gold", "expected *emphasis* to become a real <em> element");
  assert.equal(container.querySelector("strong")?.textContent, "innkeeper", "expected **strong** to become a real <strong> element");
  assert.equal(container.querySelector("code")?.textContent, "key", "expected `code` to become a real <code> element");
  assert.ok(!container.innerHTML.includes("*"), "expected no literal markup characters to survive into the rendered DOM");

  renderDialogueRichText(container, "Visit [our shop](https://example.com/shop) for supplies.");
  const link = container.querySelector("a");
  assert.equal(link?.getAttribute("href"), "https://example.com/shop", "expected an allowlisted-scheme link to become a real <a href>");
  assert.equal(link?.textContent, "our shop");

  // The security-critical case: a rejected link scheme must degrade to its
  // own text (docs/adr/0011 Decision 4) and must never become a <script>,
  // an <a href="javascript:...">, or any other element — proven here by
  // asserting on the real rendered DOM, not by trusting parseRichText's
  // own unit tests to imply this renderer wires hrefs through unchanged.
  renderDialogueRichText(container, "Click [here](javascript:alert(1)) now.");
  assert.equal(container.querySelector("a"), null, "expected a javascript: link to produce no <a> element at all");
  assert.equal(container.querySelector("script"), null, "expected no <script> element to ever appear");
  assert.equal(container.textContent, "Click here now.", "expected the rejected link's own words to survive as plain text");

  // Re-render must fully replace prior content, not append to it — proven
  // by rendering something with no <em> at all and confirming the earlier
  // render's <em> is gone.
  renderDialogueRichText(container, "Plain text only.");
  assert.equal(container.querySelector("em"), null, "expected renderDialogueRichText to clear previous content, not accumulate it");
  assert.equal(container.textContent, "Plain text only.");

  console.log("smoke-test: dialogue richtext DOM rendering PASS");
}

async function main(): Promise<void> {
  assertDialogueRichTextRendering();

  const [wasmModule, guestBundleSource] = await Promise.all([buildWasmModuleFromEmbeddedBytes(), Promise.resolve(readDialogueGuestBundle())]);
  const projectData = buildFixtureProjectData(guestBundleSource);
  const keysHeld = new Set<string>();

  const game = await bootGameLogic({ projectData, wasmModule, keysHeld });

  // 1. Real entities exist, real modules booted for real (through the
  // actual sandbox — wasmModule proves no network path was involved).
  assert.notEqual(game.playerEntity, undefined, "expected a player entity to be spawned from the player-start placement");
  assert.equal(game.npcEntityByPlacementId.size, 1, "expected one NPC entity from the npc placement");
  assert.deepEqual([...game.dialogueCapableNpcIds], ["npc-1"], "expected npc-1 to be tracked as dialogue-capable");

  // 2. Movement actually respects tile collision: hold "d" (move east)
  // toward the wall tile placed one cell east of the player's start, and
  // confirm the player does NOT cross into it after many ticks.
  keysHeld.add("d");
  const transformBefore = game.world.get<typeof TransformSchema>(game.playerEntity!, "Transform")!;
  for (let i = 0; i < 60; i++) game.tick(1000 / 60);
  const transformAfterBlocked = game.world.get<typeof TransformSchema>(game.playerEntity!, "Transform")!;
  const scene1WallWorldX = (SCENE_1_PLAYER_START.x + 1) * TILE_SIZE;
  assert.ok(
    transformAfterBlocked.x < scene1WallWorldX,
    `expected the player to be blocked before the wall tile at x=${scene1WallWorldX}, got x=${transformAfterBlocked.x}`,
  );
  assert.ok(transformAfterBlocked.x > transformBefore.x, "expected the player to have moved at all before hitting the wall");
  keysHeld.delete("d");

  // 3. The real dialogue module, running inside the real sandbox, reacts
  // to a real interact() call and emits dialogue:shown with the actual
  // configured line — proves the whole chain (host entity creation ->
  // shared World -> sandboxed ModuleBridge -> guest event handling ->
  // host-visible event) works end to end, not just that setup() didn't
  // throw.
  let shownPayload: { speaker: string; text: string } | undefined;
  game.events.on("dialogue:shown", (payload) => {
    shownPayload = payload as { speaker: string; text: string };
  });
  game.interact(); // NPC is 128 world units away, outside INTERACT_RANGE (40)
  assert.equal(shownPayload, undefined, "expected no dialogue to start — the NPC is out of interact range at boot");

  // Walk south toward the NPC, checking interact() every tick rather than
  // assuming a specific tick count lands exactly in range — the point
  // under test is "walking into range enables interact", not a precise
  // position.
  keysHeld.add("s");
  for (let i = 0; i < 120 && shownPayload === undefined; i++) {
    game.tick(1000 / 60);
    game.interact();
  }
  keysHeld.delete("s");
  assert.notEqual(shownPayload, undefined, "expected dialogue:shown once the player walked into interact range and pressed interact");
  assert.equal(shownPayload!.speaker, "Guard");
  assert.equal(shownPayload!.text, "Halt!");

  // 4. The whole point of this smoke test's second scene: transitioning
  // away from scene-1 (via the host directly calling
  // scheduler.scene.transitionTo — the same mechanism a sandboxed
  // module's ctx.scene.transitionTo() drives, per SceneManager's own doc
  // comment) actually swaps this app's live state, not just
  // SceneManager's own internal bookkeeping.
  const playerEntityBeforeTransition = game.playerEntity;
  game.scheduler.scene.transitionTo("scene-2");
  game.tick(1000 / 60); // SceneManager applies the transition, and "scene:changed" fires, at the end of this tick's fixed step.

  assert.equal(game.scheduler.scene.currentSceneId, "scene-2", "expected the scene manager to have applied the transition");
  assert.equal(game.playerEntity, playerEntityBeforeTransition, "expected the player to be the same entity across scenes, not respawned");
  assert.deepEqual(
    [...game.npcEntityByPlacementId.keys()],
    ["npc-2"],
    "expected scene-1's npc-1 to be despawned and scene-2's npc-2 to take its place",
  );
  assert.deepEqual([...game.dialogueCapableNpcIds], ["npc-2"], "expected npc-2, not npc-1, to be tracked as dialogue-capable after the transition");

  const transformAfterTransition = game.world.get<typeof TransformSchema>(game.playerEntity!, "Transform")!;
  const scene2PlayerWorldX = SCENE_2_PLAYER_START.x * TILE_SIZE + TILE_SIZE / 2;
  const scene2PlayerWorldY = SCENE_2_PLAYER_START.y * TILE_SIZE + TILE_SIZE / 2;
  assert.equal(transformAfterTransition.x, scene2PlayerWorldX, "expected the player to be repositioned to scene-2's own player-start placement");
  assert.equal(transformAfterTransition.y, scene2PlayerWorldY, "expected the player to be repositioned to scene-2's own player-start placement");

  // isWalkable now has to reflect scene-2's tiles, not scene-1's: the cell
  // that blocked movement before the transition is open in scene-2, and
  // scene-2's own wall (a different cell) blocks it instead. Proven by
  // actually walking, the same way step 2 proved it for scene-1, not by
  // reaching into gameLogic.ts's private isWalkable closure.
  keysHeld.add("d");
  const scene2TransformBefore = game.world.get<typeof TransformSchema>(game.playerEntity!, "Transform")!;
  for (let i = 0; i < 60; i++) game.tick(1000 / 60);
  const scene2TransformAfterBlocked = game.world.get<typeof TransformSchema>(game.playerEntity!, "Transform")!;
  const scene2WallWorldX = (SCENE_2_PLAYER_START.x + 1) * TILE_SIZE;
  assert.ok(
    scene2TransformAfterBlocked.x < scene2WallWorldX,
    `expected the player to be blocked before scene-2's own wall tile at x=${scene2WallWorldX}, got x=${scene2TransformAfterBlocked.x}`,
  );
  assert.ok(scene2TransformAfterBlocked.x > scene2TransformBefore.x, "expected the player to have moved at all in scene-2 before hitting its wall");
  keysHeld.delete("d");

  game.dispose();
  console.log("smoke-test: PASS");
}

main().catch((err: unknown) => {
  console.error("smoke-test: FAIL");
  console.error(err);
  process.exitCode = 1;
});
