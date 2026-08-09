// Explicit ".js" on the relative imports below, unlike sibling packages'
// own extensionless style: this package is the first one in the repo
// whose own compiled dist/ output is ever `node`-executed directly
// (scripts/smoke-test.mjs, and eventually forge export's own bundling) —
// every other consumer goes through a bundler (Vite) or imports the TS
// source directly (Vitest's esbuild transform), neither of which cares.
// Plain Node's ESM loader does care (confirmed by actually running it,
// not assumed — the exact same gap packages/runtime-host/scripts/build-smoke-cli.mjs's
// own comment already documents), so this package writes extensions
// that resolve correctly both at `tsc` compile time and at plain-Node
// runtime against the compiled output.
import { EventBusImpl, FIXED_STEP_MS, InterceptorRegistry, registerCoreComponents, Scheduler, World, type EntityId } from "@forge/core";
import { ModuleBridge } from "@forge/runtime-host";
import type { QuickJSWASMModule } from "quickjs-emscripten";
import { GRID_HEIGHT, GRID_WIDTH, TILE_SIZE } from "./gridConstants.js";
import { createPlayerMovementSystem, INTERACT_RANGE, spawnNpcMarker, spawnPlayer, type HeldKeys } from "./gameWorld.js";
import type { PlayerProjectData } from "./playerProjectData.js";

/** CLAUDE.md 7's "Per-module frame cost: 1.0 ms warn, 2.0 ms kill" — a real per-tick budget, not the generous one-off `runModuleSmokeTest` uses for a single `setup()` call. A module stuck past this is interrupted, not allowed to freeze the frame. */
const PER_MODULE_COMPUTE_BUDGET_MS = 2;
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const MAX_STACK_SIZE_BYTES = 1024 * 1024;

function tileCenterWorld(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX * TILE_SIZE + TILE_SIZE / 2, y: tileY * TILE_SIZE + TILE_SIZE / 2 };
}

export interface GameLogicOptions {
  readonly projectData: PlayerProjectData;
  /**
   * See `ModuleRuntimeOptions.wasmModule`'s own doc comment
   * (`@forge/runtime-host`) — omit to use the default `getQuickJS()`
   * singleton (fine for dev/tests with network access); the real
   * `forge export` bundle always supplies this, built from WASM bytes
   * embedded in the export itself, since a `file://`-opened page cannot
   * `fetch()` or XHR its way to the default singleton's WASM payload.
   */
  readonly wasmModule?: QuickJSWASMModule;
  readonly isWalkable: (worldX: number, worldY: number) => boolean;
  /** Live reference — reads the *current* held-keys set on every tick, same contract as `packages/editor/src/preview/gameWorld.ts`'s own `createPlayerMovementSystem`. */
  readonly keysHeld: HeldKeys;
}

/**
 * A live, running game: one real `@forge/core` `World` shared by the
 * player/NPC entities (host-owned) and every installed module's own
 * entities and systems (each running inside a real, separately sandboxed
 * `ModuleBridge` over that same `World`) — the single-shared-world design
 * `ModuleBridge`'s own doc comment describes ("modules cooperate in one
 * shared game world by design"), unlike the editor's own unsandboxed
 * preview (`packages/editor/src/preview/PreviewApp.tsx`), which gives
 * the dialogue module a second, disposable world of its own since its
 * `directModuleHost.ts` shortcut was built before the real sandboxed path
 * existed to lean on instead.
 */
export interface GameLogic {
  readonly world: World;
  readonly scheduler: Scheduler;
  readonly events: EventBusImpl;
  readonly playerEntity: EntityId | undefined;
  readonly npcEntityByPlacementId: ReadonlyMap<string, EntityId>;
  /** Placement id of every NPC a dialogue-tracking entity exists for — the `treeId` `startDialogue` expects. */
  readonly dialogueCapableNpcIds: ReadonlySet<string>;
  tick(dtMs: number): void;
  /** "E"-to-interact, same nearest-in-range rule as the editor's unsandboxed preview. Emits `dialogue:start` on the shared event bus if an NPC is in range; no-ops otherwise (nothing in range, or no dialogue module installed). */
  interact(): void;
  dispose(): void;
}

/**
 * Boots one real, playable game from `options.projectData` — the actual
 * "standalone player" claim (M6 Phase 5d): every installed module runs
 * through the same real sandboxed `ModuleBridge`/`ModuleRuntime`
 * `packages/runtime-host`'s own security-mandate tests already prove
 * holds (`sandbox-escape.test.ts`), never `packages/editor`'s
 * unsandboxed `directModuleHost.ts` shortcut — that file's own doc
 * comment names exactly this milestone as the one that must not reuse it.
 *
 * Pure game-logic boot: no `RenderHost`/Pixi/DOM here at all, so this
 * (and its own tests) runs in plain Node — the Pixi rendering half is a
 * separate, thin layer (`render.ts`) over this same `World`/`Scheduler`,
 * the same split `packages/editor/src/preview/gameWorld.ts` and
 * `PreviewApp.tsx` already keep.
 */
export async function bootGameLogic(options: GameLogicOptions): Promise<GameLogic> {
  const world = new World();
  registerCoreComponents(world);
  const scheduler = new Scheduler(world);
  const events = new EventBusImpl();
  const interceptors = new InterceptorRegistry();

  scheduler.addSystem(createPlayerMovementSystem(world, options.isWalkable, options.keysHeld));

  const scene = options.projectData.scenes.find((candidate) => candidate.id === options.projectData.startSceneId);
  if (!scene) {
    throw new Error(`bootGameLogic: projectData has no scene with id "${options.projectData.startSceneId}" (startSceneId)`);
  }
  // A wrongly-shaped tiles array would silently misplace every later tile
  // lookup (isWalkable, rendering) rather than fail loudly — worth
  // checking since this is the export bundle's own embedded data, not
  // something a person can just re-edit and retry like the editor's own
  // live canvas.
  if (scene.tiles.length !== GRID_WIDTH * GRID_HEIGHT) {
    throw new Error(
      `bootGameLogic: scene "${scene.id}" has ${scene.tiles.length} tiles, expected ${GRID_WIDTH * GRID_HEIGHT} (${GRID_WIDTH}x${GRID_HEIGHT})`,
    );
  }

  let playerEntity: EntityId | undefined;
  const npcEntityByPlacementId = new Map<string, EntityId>();
  const dialogueCapableNpcIds = new Set<string>();
  for (const placement of scene.entities) {
    const { x, y } = tileCenterWorld(placement.tileX, placement.tileY);
    if (placement.kind === "player-start") {
      playerEntity = spawnPlayer(world, x, y);
    } else {
      npcEntityByPlacementId.set(placement.id, spawnNpcMarker(world, x, y));
    }
  }
  world.flush();

  const bridges: ModuleBridge[] = [];
  for (const installedModule of options.projectData.installedModules) {
    const bridge = await ModuleBridge.create({
      moduleName: installedModule.name,
      version: installedModule.version,
      engineVersion: options.projectData.engineVersion,
      config: installedModule.config,
      world,
      scheduler,
      events,
      interceptors,
      memoryLimitBytes: MEMORY_LIMIT_BYTES,
      maxStackSizeBytes: MAX_STACK_SIZE_BYTES,
      computeBudgetMs: PER_MODULE_COMPUTE_BUDGET_MS,
      ...(options.wasmModule ? { wasmModule: options.wasmModule } : {}),
    });
    const outcome = bridge.setup(installedModule.guestBundleSource);
    if (!outcome.ok) {
      bridge.dispose();
      for (const b of bridges) b.dispose();
      throw new Error(`bootGameLogic: module "${installedModule.name}" failed setup(): ${outcome.error.message}`);
    }
    bridges.push(bridge);
  }

  // Dialogue-tracking entities: a bare entity per NPC that declares
  // dialogue, created directly against the shared World (a plain
  // @forge/core call — no bridge involved, same as the host-owned
  // player/NPC marker entities above). The dialogue module's own guest
  // code adds its DialogueState component lazily, the first time a
  // dialogue actually starts for that entity (its own `showNode`
  // function's `ctx.world.has(...)` branch) — mirrors
  // PreviewApp.tsx's `rebuildDialogueRuntime` exactly, just against the
  // one real shared World instead of a disposable private one.
  for (const placement of scene.entities) {
    if (placement.kind !== "npc" || !placement.dialogue) continue;
    if (!npcEntityByPlacementId.has(placement.id)) continue;
    dialogueCapableNpcIds.add(placement.id);
  }

  return {
    world,
    scheduler,
    events,
    playerEntity,
    npcEntityByPlacementId,
    dialogueCapableNpcIds,
    tick(dtMs: number): void {
      scheduler.tick(dtMs);
    },
    interact(): void {
      if (playerEntity === undefined || dialogueCapableNpcIds.size === 0) return;
      const playerTransform = world.get<{ x: "f64"; y: "f64" }>(playerEntity, "Transform") as { x: number; y: number } | undefined;
      if (!playerTransform) return;

      // Starts AT the interact range, not Infinity — a candidate only
      // qualifies at all if within range; this is a bounded "nearest
      // within range" search, not "nearest regardless of distance"
      // (same shape as PreviewApp.tsx's own keydown handler).
      let nearestId: string | undefined;
      let nearestDistance = INTERACT_RANGE;
      for (const placementId of dialogueCapableNpcIds) {
        const npcEntity = npcEntityByPlacementId.get(placementId);
        if (npcEntity === undefined) continue;
        const npcTransform = world.get<{ x: "f64"; y: "f64" }>(npcEntity, "Transform") as { x: number; y: number } | undefined;
        if (!npcTransform) continue;
        const distance = Math.hypot(playerTransform.x - npcTransform.x, playerTransform.y - npcTransform.y);
        if (distance <= nearestDistance) {
          nearestDistance = distance;
          nearestId = placementId;
        }
      }
      if (nearestId === undefined) return;
      const dialogueEntity = npcEntityByPlacementId.get(nearestId)!;
      events.emit("dialogue:start", { entity: dialogueEntity, treeId: nearestId });
    },
    dispose(): void {
      for (const bridge of bridges) bridge.dispose();
    },
  };
}
