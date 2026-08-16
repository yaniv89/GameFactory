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
import { EventBusImpl, FIXED_STEP_MS, InterceptorRegistry, registerCoreComponents, Scheduler, World, type EntityId, type SceneChangedEvent } from "@forge/core";
import { ModuleBridge } from "@forge/runtime-host";
import type { QuickJSWASMModule } from "quickjs-emscripten";
import { GRID_HEIGHT, GRID_WIDTH, TILE_SIZE } from "./gridConstants.js";
import { createPlayerMovementSystem, INTERACT_RANGE, spawnNpcMarker, spawnPlayer, type HeldKeys } from "./gameWorld.js";
import type { PlayerProjectData, PlayerScene } from "./playerProjectData.js";
import { WALL_TILE_ID } from "./tilePalette.js";

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
  /** One per installed module, in `projectData.installedModules` order — save.ts needs these directly for `createSave`/`loadSave` (`packages/runtime-host/src/save/saveCoordinator.ts`). */
  readonly bridges: readonly ModuleBridge[];
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
  const events = new EventBusImpl();
  // `initialSceneId` makes `ctx.scene.currentSceneId` real for every
  // installed module from the first tick, and `events` means a module's
  // `ctx.scene.transitionTo()` call genuinely fires "scene:changed" on the
  // same bus modules already use for everything else (dialogue, etc.) —
  // see github.com/yaniv89/GameFactory/issues/3. The handler registered
  // near the end of this function is what makes this app itself react to
  // that event by swapping tile/entity content, closing the gap this
  // comment used to describe.
  const scheduler = new Scheduler(world, { events, initialSceneId: options.projectData.startSceneId });
  const interceptors = new InterceptorRegistry();

  function findScene(sceneId: string): PlayerScene {
    const scene = options.projectData.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) {
      throw new Error(`bootGameLogic: projectData has no scene with id "${sceneId}"`);
    }
    // A wrongly-shaped tiles array would silently misplace every later
    // tile lookup (isWalkable, rendering) rather than fail loudly — worth
    // checking since this is the export bundle's own embedded data, not
    // something a person can just re-edit and retry like the editor's own
    // live canvas. Checked on every scene lookup, not just the start
    // scene, since a `ctx.scene.transitionTo()` into a malformed later
    // scene deserves the same loud failure as a malformed start scene.
    if (scene.tiles.length !== GRID_WIDTH * GRID_HEIGHT) {
      throw new Error(
        `bootGameLogic: scene "${scene.id}" has ${scene.tiles.length} tiles, expected ${GRID_WIDTH * GRID_HEIGHT} (${GRID_WIDTH}x${GRID_HEIGHT})`,
      );
    }
    return scene;
  }

  // Mutable, unlike everything else captured by the closures below — this
  // is specifically the piece of state "scene:changed" exists to update.
  let currentScene = findScene(options.projectData.startSceneId);

  // Reads currentScene fresh on every call rather than closing over a
  // snapshot: the whole point of reacting to "scene:changed" is that
  // movement collision has to track whichever scene is actually current,
  // not just the one this app booted into.
  const isWalkable = (worldX: number, worldY: number): boolean => {
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    if (tileX < 0 || tileY < 0 || tileX >= GRID_WIDTH || tileY >= GRID_HEIGHT) return false;
    return currentScene.tiles[tileY * GRID_WIDTH + tileX] !== WALL_TILE_ID;
  };
  scheduler.addSystem(createPlayerMovementSystem(world, isWalkable, options.keysHeld));

  let playerEntity: EntityId | undefined;
  const npcEntityByPlacementId = new Map<string, EntityId>();
  const dialogueCapableNpcIds = new Set<string>();

  // Spawns (or, for the player, repositions) `scene`'s entity placements.
  // Shared between the initial boot and every later "scene:changed"
  // reaction so there is exactly one place this logic lives, not two
  // copies to keep in sync by inspection.
  function applySceneEntities(scene: PlayerScene): void {
    for (const placement of scene.entities) {
      const { x, y } = tileCenterWorld(placement.tileX, placement.tileY);
      if (placement.kind === "player-start") {
        // The player is the same entity across every scene, not
        // respawned — this placement just says where they land in this
        // one. Only spawned fresh the first time any scene declares one.
        if (playerEntity === undefined) {
          playerEntity = spawnPlayer(world, x, y);
        } else {
          world.set(playerEntity, "Transform", { x, y });
        }
        continue;
      }

      // Dialogue-tracking is folded into the same pass, not a separate
      // one over `scene.entities` afterward (an earlier version of this
      // function did it that way only because bridges hadn't booted yet
      // at the point it ran for the very first scene — a constraint that
      // doesn't apply to `scene.entities` itself, which needs nothing
      // from a bridge to answer "does this placement declare dialogue").
      // No bare tracking entity beyond the NPC marker itself: the
      // dialogue module's own guest code adds its DialogueState component
      // lazily, the first time a dialogue actually starts for this entity
      // (its own `showNode` function's `ctx.world.has(...)` branch) —
      // mirrors `PreviewApp.tsx`'s `rebuildDialogueRuntime` exactly, just
      // against the one real shared World instead of a disposable one.
      const npcEntity = spawnNpcMarker(world, x, y);
      npcEntityByPlacementId.set(placement.id, npcEntity);
      if (placement.dialogue) dialogueCapableNpcIds.add(placement.id);
    }
  }

  // The inverse of applySceneEntities for the NPC half only: every NPC
  // entity is scene-scoped, so leaving a scene destroys them rather than
  // letting them silently pile up off in some other scene's coordinate
  // space. The player is left alone here — see applySceneEntities above.
  function despawnSceneNpcs(): void {
    for (const npcEntity of npcEntityByPlacementId.values()) {
      world.destroy(npcEntity);
    }
    npcEntityByPlacementId.clear();
    dialogueCapableNpcIds.clear();
  }

  applySceneEntities(currentScene);
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
    const outcome = await bridge.setup(installedModule.guestBundleSource);
    if (!outcome.ok) {
      bridge.dispose();
      for (const b of bridges) b.dispose();
      throw new Error(`bootGameLogic: module "${installedModule.name}" failed setup(): ${outcome.error.message}`);
    }
    bridges.push(bridge);
  }

  // Reacts to every future scene transition, from any source — a
  // module's own `ctx.scene.transitionTo()` call, or a native system
  // calling `scheduler.scene.transitionTo()` directly. Despawns the old
  // scene's NPCs, spawns (or repositions) the new scene's, and updates
  // `currentScene` so `isWalkable`'s very next call already reflects the
  // new grid. All of it settles within the same `tick()` call this event
  // fires inside: `SceneManager` emits "scene:changed" from
  // `Scheduler.tick()` after every fixed-step phase has run for that
  // step, and the `World.destroy()`/`create()` calls made here are
  // flushed by that same `tick()` call's remaining phases (each phase
  // ends with `world.flush()`) before control ever returns to the caller
  // — no extra flush needed here, and nothing left half-applied for a
  // renderer or another system to observe mid-transition.
  events.on("scene:changed", (payload) => {
    const { to } = payload as SceneChangedEvent;
    const nextScene = findScene(to);
    despawnSceneNpcs();
    applySceneEntities(nextScene);
    currentScene = nextScene;
  });

  return {
    world,
    scheduler,
    events,
    bridges,
    // A getter, not a plain field: if the very first scene has no
    // player-start placement, `playerEntity` stays undefined at the time
    // this object is constructed, and only becomes real once some later
    // scene (reached via "scene:changed") declares one. A plain field
    // captured here would freeze at that initial `undefined` forever;
    // this reads the live outer binding on every access instead.
    get playerEntity(): EntityId | undefined {
      return playerEntity;
    },
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
