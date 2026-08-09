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
import { newQuickJSWASMModuleFromVariant, newVariant, RELEASE_SYNC, type QuickJSWASMModule } from "quickjs-emscripten";
import { bootGameLogic } from "../gameLogic.js";
import type { PlayerProjectData } from "../playerProjectData.js";

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

function buildFixtureProjectData(guestBundleSource: string): PlayerProjectData {
  const tiles = new Array(GRID_WIDTH * GRID_HEIGHT).fill(0);
  const playerStartX = 2;
  const playerStartY = 2;
  // A wall tile directly east of the player's start, so isWalkable
  // actually has something real to block.
  tiles[playerStartY * GRID_WIDTH + (playerStartX + 1)] = 1;

  return {
    projectId: "smoke-test-project",
    buildId: "smoke-test-build",
    schemaVersion: 1,
    engineVersion: "0.0.0-smoke-test",
    scenes: [
      {
        id: "scene-1",
        name: "Test Scene",
        tiles,
        entities: [
          { id: "player", kind: "player-start", tileX: playerStartX, tileY: playerStartY },
          {
            id: "npc-1",
            kind: "npc",
            tileX: playerStartX,
            // 4 tiles south = 128 world units — outside gameWorld.ts's
            // INTERACT_RANGE (40) at boot, so "walking into range" is a
            // real state change the test below exercises, not
            // already-true-at-boot.
            tileY: playerStartY + 4,
            dialogue: { speaker: "Guard", text: "Halt!" },
          },
        ],
      },
    ],
    installedModules: [
      {
        name: "@forge/dialogue",
        version: "1.0.0",
        config: { trees: [{ id: "npc-1", nodes: [{ speaker: "Guard", text: "Halt!" }] }] },
        guestBundleSource,
      },
    ],
    startSceneId: "scene-1",
  };
}

async function main(): Promise<void> {
  const [wasmModule, guestBundleSource] = await Promise.all([buildWasmModuleFromEmbeddedBytes(), Promise.resolve(readDialogueGuestBundle())]);
  const projectData = buildFixtureProjectData(guestBundleSource);
  const scene = projectData.scenes[0]!;

  const isWalkable = (worldX: number, worldY: number): boolean => {
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    if (tileX < 0 || tileY < 0 || tileX >= GRID_WIDTH || tileY >= GRID_HEIGHT) return false;
    return scene.tiles[tileY * GRID_WIDTH + tileX] !== 1;
  };
  const keysHeld = new Set<string>();

  const game = await bootGameLogic({ projectData, wasmModule, isWalkable, keysHeld });

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
  const wallWorldX = (2 + 1) * TILE_SIZE;
  assert.ok(transformAfterBlocked.x < wallWorldX, `expected the player to be blocked before the wall tile at x=${wallWorldX}, got x=${transformAfterBlocked.x}`);
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

  game.dispose();
  console.log("smoke-test: PASS");
}

main().catch((err: unknown) => {
  console.error("smoke-test: FAIL");
  console.error(err);
  process.exitCode = 1;
});
