import {
  COIN_ITEM_ID,
  COIN_PICKUP_PREFAB,
  MOUNT_PREFAB,
  createCharacterAnimationSystem,
  createEnemyAiSystem,
  createEquipmentSystem,
  createFloatingTextSystem,
  createHitFlashSystem,
  createKnockbackPhysicsSystem,
  createMeleeAttackSystem,
  createMountSystem,
  createPickupSystem,
  createVfxParticleSystem,
  registerCoreComponents,
  spawnVfxBurst,
  EventBusImpl,
  HealthSchema,
  Scheduler,
  TransformSchema,
  VelocitySchema,
  World,
  type EntityId,
  type EventBus,
  type MeleeAttackEventMap,
  type PickupEventMap,
} from "@forge/core";
import { dialogueModule } from "@forge/dialogue";
import { inventoryModule, type InventoryChangedEvent } from "@forge/inventory";
import { buildDialogueTreesFromEntities } from "@forge/project-export";
import {
  Camera,
  RenderHost,
  TilemapLayer,
  computeAutotileBitmask,
  createSpriteSyncSystem,
  createTextSyncSystem,
  createTransformSnapshotSystem,
  TransformSnapshotStore,
} from "@forge/render-2d";
import { Sprite, Text, type Texture } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { buildPackAwareCharacterTextures, type CharacterFrameSet } from "../canvas/characterTextures";
import { buildEntityTextures, VFX_PARTICLE_TEXTURE_KEY, WEAPON_MARKER_TEXTURE_KEY } from "../canvas/entityMarkers";
import { GRID_HEIGHT, GRID_WIDTH, TILE_SIZE } from "../canvas/gridConstants";
import { loadActivePackContext } from "../canvas/packTiles";
import { WALL_TILE_ID, buildAutotileWallTextures, buildPaletteTextures } from "../canvas/tilePalette";
import type { EntityPlacement } from "../store/projectStore";
import { fitZoom as fitZoomOf, followCamera as followCameraOf, followZoom as followZoomOf } from "./cameraFollow";
import { buildDecorationTextures, computeDecorationTiles } from "./decorationTiles";
import { createModuleRuntime } from "./directModuleHost";
import { createPreviewAudio, type PreviewAudio } from "./previewAudio";
import {
  COIN_ASSET_ID,
  ENEMY_ASSET_ID,
  INTERACT_RANGE,
  MOUNT_ASSET_ID,
  NPC_ASSET_ID,
  PLAYER_ASSET_ID,
  VFX_PARTICLE_ASSET_ID,
  WEAPON_ASSET_ID,
  createPlayerMovementSystem,
  spawnCoinPickup,
  spawnEnemy,
  spawnMount,
  spawnNpcMarker,
  spawnPlayer,
} from "./gameWorld";
import { TRUSTED_EDITOR_ORIGIN } from "./origins";
import { isPreviewSceneMessage } from "./protocol";
import { RichDialogueText } from "./RichDialogueText";
import "./PreviewApp.css";

/** `Sprite.assetId` -> the active pack's own `characters.sheets` role id — the one place this preview maps "which prefab" to "which pack-declared art role." */
const ASSET_ID_TO_CHARACTER_ROLE: Readonly<Record<number, string>> = {
  [PLAYER_ASSET_ID]: "hero",
  [NPC_ASSET_ID]: "villager",
  [ENEMY_ASSET_ID]: "goblin",
};

/**
 * I1e's item-id bridge: `Pickup.itemId` (@forge/core) is a plain numeric
 * field — the fixed-shape component schema (docs/adr/0002) has no string
 * fields — but `@forge/inventory`'s own event API keys items by string,
 * matching a real item-definition table's natural id shape once one
 * exists. Until then this is the one place "which numeric Pickup id means
 * which inventory item key" is decided, the same "no real registry yet,
 * agreed out of band" honesty `COIN_ITEM_ID`'s own doc comment already
 * accepts.
 */
const ITEM_KEY_FOR_ID: Readonly<Record<number, string>> = {
  [COIN_ITEM_ID]: "coin",
};

/** Every character sheet this repo's own generated art (`gensprite_h1.py`) and `createCharacterAnimationSystem` agree on: a 4-direction, 4-frame walk cycle at 8fps. A pack declaring a different `walk` animation shape is a known limitation, not silently handled — see `characterTextures.ts`'s own doc comment on what a pack can and can't override yet. */
const WALK_FRAME_COUNT = 4;
const WALK_FPS = 8;

/** H1c's fixed demo enemy spawn — see `spawnEnemy`'s own doc comment for why this isn't sourced from scene placements yet. Tile (13, 8), a few tiles from a typical player start, well clear of the map's own edges. */
const DEMO_ENEMY_TILE = { x: 13, y: 8 };

/** I1b's fixed demo mount spawn — same "not sourced from scene placements yet" gap `spawnMount`'s own doc comment states. Tile (5, 8): same walkable row as `DEMO_ENEMY_TILE`, well clear of it and of the map's own edges. */
const DEMO_MOUNT_TILE = { x: 5, y: 8 };

/** I1c's equip/unequip toggle — a dedicated key, not folded into "E": that key is already a context-sensitive interact chain (NPC dialogue, then mount/dismount), whereas equipping is a loadout choice about the wearer's own state, not a nearby world object. */
const EQUIP_TOGGLE_KEY = "r";
/** World-units distance the wielded-weapon visual renders in front of the wearer, along facing — inside MELEE_REACH (below) so it visibly reads as "the thing about to swing," not floating out past the hitbox. */
const WEAPON_OFFSET = 16;

/** H1c's melee-swing tuning — one designed unit, not scattered magic numbers at each call site. */
const MELEE_ATTACK_KEY = " "; // Space — KeyboardEvent.key for the spacebar.
const MELEE_REACH = 24;
const MELEE_SIZE = 22;
const MELEE_DAMAGE = 10;
const MELEE_KNOCKBACK_SPEED = 220;
const MELEE_INVULNERABILITY_SEC = 0.4;
const MELEE_FLASH_SEC = 0.15;

/**
 * I1a's enemy-AI tuning — the mirror image of the MELEE_* block above:
 * this is what an `EnemyAi` entity does *to the player*, not what the
 * player does to it. `ENEMY_ATTACK_RANGE` deliberately matches
 * `MELEE_REACH` (both sides of the same-size scuffle); `ENEMY_ATTACK_DAMAGE`
 * is set below `MELEE_DAMAGE` so a stationary, unresponsive player loses a
 * fight to a single enemy slower than the enemy loses to an attentive
 * player — the intended difficulty shape for a first encounter, not a
 * balance afterthought. `ENEMY_DETECT_RADIUS`/`ENEMY_WANDER_RADIUS` are in
 * world units (TILE_SIZE=32), roughly 4 and 2 tiles respectively.
 */
const ENEMY_DETECT_RADIUS = 130;
const ENEMY_ATTACK_RANGE = MELEE_REACH;
const ENEMY_ATTACK_DAMAGE = 6;
const ENEMY_ATTACK_COOLDOWN_SEC = 1;
const ENEMY_ATTACK_INVULNERABILITY_SEC = 0.4;
const ENEMY_ATTACK_FLASH_SEC = 0.15;
const ENEMY_WANDER_RADIUS = 64;
const ENEMY_WANDER_SPEED = 40;

/** H1d's damage-number tuning. */
const DAMAGE_NUMBER_TTL_SEC = 0.8;
const DAMAGE_NUMBER_SPAWN_OFFSET_Y = -14; // spawn just above the target's own anchor point, not centered on it

/**
 * I1d's hit-effect pipeline tuning — real `VfxBurstOptions` (@forge/core),
 * not scattered magic numbers at each `spawnVfxBurst` call site. Replaces
 * H1d's original ad hoc, ECS-external death-particle-burst code (raw
 * `Pixi.Graphics` state hand-updated in this file's own `onTick`) with the
 * real, tested `createVfxParticleSystem`.
 */
const DEATH_BURST_OPTIONS = {
  count: 10,
  minSpeed: 60,
  maxSpeed: 160,
  ttl: 0.5,
  tint: 0x5d964d, // goblin skin (gensprite_h1.py's GOBLIN palette) — this repo's only enemy today
  particleAssetId: VFX_PARTICLE_ASSET_ID,
} as const;
/** A smaller, quicker, neutral-colored burst on every landed hit (not just a kill) — a felt "impact spark" H1d never had, since the old ad hoc code only fired on death. */
const IMPACT_SPARK_OPTIONS = {
  count: 5,
  minSpeed: 40,
  maxSpeed: 110,
  ttl: 0.25,
  tint: 0xf2d98a, // pale spark — distinct from DEATH_BURST_OPTIONS' own green and from --accent-running's amber
  particleAssetId: VFX_PARTICLE_ASSET_ID,
} as const;

/** H1f's footstep cadence — world units of real player travel between footstep cues, not a fixed timer, so a step lands at the same point in the walk cycle regardless of frame rate. Close to a walk-cycle stride at TILE_SIZE's own scale. */
const FOOTSTEP_STRIDE_DISTANCE = 26;

/**
 * H1g's multi-layer draw order. Both are large negative numbers so they
 * sort strictly below *every* entity/floating-text sprite (whose own
 * `zIndex` is `Transform.y`, always well above 0 for anything on this
 * map) regardless of insertion order — the ground layer receives live
 * repaints from SceneCanvas at any time, so relying on "ground sprites
 * were all added before decoration sprites" would silently break the
 * moment a *new* ground tile is painted into a previously-empty cell
 * after the decoration layer already has sprites on screen.
 */
const GROUND_LAYER_Z_INDEX = -3;
const DECORATION_LAYER_Z_INDEX = -2;

type PreviewStatus = "loading" | "ready" | "error";

interface RenderRig {
  readonly host: RenderHost;
  readonly camera: Camera;
  /** The ground layer — real, player-painted tile ids, autotiled where the id is Wall (see `GROUND_LAYER_Z_INDEX`'s own doc comment). */
  readonly layer: TilemapLayer<Sprite>;
  /** H1g's second tilemap layer — see `decorationTiles.ts`'s own doc comment for what drives it and why it isn't player-authored yet. */
  readonly decorationLayer: TilemapLayer<Sprite>;
  /**
   * The ground layer's own live tile ids, mutated in place (never
   * reassigned) — the same array `layer`'s `resolveTileTexture` closure
   * reads to compute a Wall cell's own autotile bitmask. Exposed here so
   * the scene-message effect (a separate `useEffect`, no access to the
   * boot effect's own local variables) can keep it in sync with
   * `layer.setTile` calls and force wall-neighbor sprite refreshes.
   */
  readonly groundTiles: number[];
}

/** The always-on ECS world: player + NPC render/movement entities. Created once at boot and never recreated — recreating it would reset the player's position on every tile paint or entity edit. */
interface GameWorld {
  readonly world: World;
  readonly scheduler: Scheduler;
  playerEntity: EntityId | undefined;
  readonly npcEntitiesByPlacementId: Map<string, EntityId>;
  /** H1c's fixed demo combat target (`spawnEnemy`'s own doc comment explains why it isn't placement-sourced yet). */
  readonly enemyEntity: EntityId;
  /** I1b's fixed demo mount (`spawnMount`'s own doc comment explains why it isn't placement-sourced yet). */
  readonly mountEntity: EntityId;
  /** `createMeleeAttackSystem`'s own event bus — H1d's damage-number/death-particle work subscribes to `"combat:hit"`/`"combat:death"` here. */
  readonly combatEvents: EventBus<MeleeAttackEventMap>;
  /** `createPickupSystem`'s own event bus — H1e's HUD coin-slot counter subscribes to `"pickup:collected"` here. */
  readonly pickupEvents: EventBus<PickupEventMap>;
}

/** The dialogue module's own world, rebuilt whenever the NPC/dialogue set changes (see the doc comment on the scene-message effect below for why this is a *separate*, disposable world from GameWorld). */
interface DialogueRuntime {
  readonly runtime: ReturnType<typeof createModuleRuntime>;
  readonly dialogueEntityByPlacementId: Map<string, EntityId>;
}

interface DialogueBubble {
  readonly speaker: string;
  readonly text: string;
}

/** --surface-canvas from tokens.css, as a Pixi-friendly hex number. */
const CANVAS_BACKGROUND = 0x232a26;
const DIALOGUE_BUBBLE_MS = 3500;

const WORLD_WIDTH = GRID_WIDTH * TILE_SIZE;
const WORLD_HEIGHT = GRID_HEIGHT * TILE_SIZE;

function fitZoom(viewportWidth: number, viewportHeight: number): number {
  return fitZoomOf(viewportWidth, viewportHeight, WORLD_WIDTH, WORLD_HEIGHT);
}

function followZoom(viewportWidth: number, viewportHeight: number): number {
  return followZoomOf(viewportWidth, viewportHeight, WORLD_WIDTH, WORLD_HEIGHT);
}

function followCamera(camera: Camera, targetX: number, targetY: number): void {
  followCameraOf(camera, targetX, targetY, WORLD_WIDTH, WORLD_HEIGHT);
}

function tileCenterWorld(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX * TILE_SIZE + TILE_SIZE / 2, y: tileY * TILE_SIZE + TILE_SIZE / 2 };
}

/**
 * The preview iframe's own root — a genuinely running game (Phase 7), not
 * just a static render of whatever the editor's SceneCanvas last
 * painted: a real `@forge/core` World drives a walkable player (WASD/
 * arrows), tile-grid collision against Wall tiles, and NPCs that show a
 * real one-line `@forge/dialogue` conversation on interact ("E"). All
 * driven by scene data received over the postMessage bridge (protocol.ts)
 * — this document is a genuinely separate page (play.forge.dev in
 * production, docs/SPEC.md 10.6), reachable only through that channel.
 *
 * The same StrictMode-safe boot/dispose lifecycle as SceneCanvas
 * (packages/editor/src/canvas/SceneCanvas.tsx's doc comment explains the
 * race it guards against) — duplicated rather than extracted into a
 * shared hook, since the two consumers' post-boot setup differs enough
 * (paint tool vs. postMessage listener) that factoring it out now would
 * be speculative; revisit if a third consumer appears.
 */
export function PreviewApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rigRef = useRef<RenderRig | null>(null);
  const gameWorldRef = useRef<GameWorld | null>(null);
  const dialogueRef = useRef<DialogueRuntime | null>(null);
  /** Populated asynchronously once a `forge:preview:scene` message names an `activePack` — read every tick by the sprite-sync `resolveTexture` closure below, which is wired once at boot before any pack has necessarily loaded. Empty map (not undefined) so a lookup miss and "still loading" look identical: fall back to the placeholder marker either way. */
  const characterTexturesRef = useRef<Map<string, CharacterFrameSet>>(new Map());
  /** The `activePack` name this preview has already loaded (or attempted to) — guards against re-fetching the same pack's manifest on every scene message (tile paints fire these constantly) and against a stale, slower-to-resolve fetch clobbering a newer one. */
  const loadedPackNameRef = useRef<string | undefined>(undefined);
  /** The panel's current pixel size — read by the per-tick camera-follow logic (H1b) so it doesn't need to re-measure the DOM every frame; kept current by the boot effect and the resize observer below. */
  const viewportSizeRef = useRef({ width: 1, height: 1 });
  const keysHeldRef = useRef<Set<string>>(new Set());
  /** Set true on a Space keydown, consumed (and cleared) by `createMeleeAttackSystem`'s `consumeAttackRequest` — an edge, not "held," so pinning the key down doesn't spam a swing every tick. */
  const attackRequestedRef = useRef(false);
  /** I1b's mount/dismount request: set true on an "E" press that found no NPC dialogue target in range, consumed (and cleared) by `createMountSystem`'s own `consumeMountRequest` — the same "own the input state" edge shape `attackRequestedRef` already establishes. */
  const mountRequestedRef = useRef(false);
  /** I1c's equip/unequip request: set true on an `EQUIP_TOGGLE_KEY` press, consumed (and cleared) by `createEquipmentSystem`'s own `consumeEquipRequest` — the same edge shape `attackRequestedRef`/`mountRequestedRef` already establish. */
  const equipRequestedRef = useRef(false);
  const bubbleTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lifecycleRef = useRef<Promise<void>>(Promise.resolve());
  const tickerCallbackRef = useRef<((ticker: { deltaMS: number }) => void) | null>(null);
  /**
   * H1e's HUD health bar is driven straight from the ECS every tick
   * (`onTick`, below) via direct DOM mutation through these refs, not
   * React state — Health can change every fixed step once something
   * damages the player (I1's job; nothing does yet), and routing that
   * through `setState` would re-render the whole component at up to 60Hz
   * for a single number. The coin-slot counter below is the opposite
   * shape on purpose: pickups are rare, discrete events, so plain React
   * state (the same "event fires, setState once" shape `bubble`'s own
   * `onShown` callback already uses) is the right tool there.
   */
  const healthBarRootRef = useRef<HTMLDivElement>(null);
  const healthBarFillRef = useRef<HTMLDivElement>(null);
  const healthBarLabelRef = useRef<HTMLSpanElement>(null);
  /** H1f's audio layer, created once at boot and disposed on unmount — see previewAudio.ts's own doc comment for why this is raw Web Audio rather than a library. */
  const previewAudioRef = useRef<PreviewAudio | null>(null);
  /** World units of player travel accumulated since the last footstep cue — distance-based cadence, not a fixed timer, so a step always lands at the same point in the walk regardless of frame rate. */
  const footstepDistanceRef = useRef(0);

  const [status, setStatus] = useState<PreviewStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [bubble, setBubble] = useState<DialogueBubble | null>(null);
  const [coinCount, setCoinCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const bootPromise = lifecycleRef.current.then(async () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      try {
        const { width, height } = container.getBoundingClientRect();
        const host = await RenderHost.create({
          canvas,
          viewportWidth: Math.max(1, Math.floor(width)),
          viewportHeight: Math.max(1, Math.floor(height)),
          backgroundColor: CANVAS_BACKGROUND,
        });

        if (cancelled) {
          host.destroy();
          return;
        }

        // Fit-the-whole-map, centered — same as before H1b, and kept until
        // a real player entity exists to follow (below). Zooming in before
        // there's anyone to center on would just be an arbitrary crop of
        // an otherwise-empty map, not a camera "following" anything.
        viewportSizeRef.current = { width, height };
        const camera = new Camera({ viewportWidth: width, viewportHeight: height });
        camera.zoom = fitZoom(width, height);
        camera.x = (GRID_WIDTH * TILE_SIZE) / 2;
        camera.y = (GRID_HEIGHT * TILE_SIZE) / 2;
        camera.applyTo(host.worldContainer);

        const paletteTextures = buildPaletteTextures(host.app.renderer, TILE_SIZE);
        const wallTextures = buildAutotileWallTextures(host.app.renderer, TILE_SIZE);
        const decorationTextures = buildDecorationTextures(host.app.renderer, TILE_SIZE);

        // Owned separately from the TilemapLayer's own internal copy: a
        // resolveTileTexture closure needs to read the *live* grid to
        // compute a Wall cell's own autotile bitmask, but that closure is
        // invoked from inside `new TilemapLayer(...)` itself (once per
        // initially-non-empty cell) — referencing the `layer` binding
        // there would hit its own not-yet-initialized value. Since every
        // cell starts empty (below) this particular ordering hazard can't
        // actually fire yet, but keeping an explicit, independently-owned
        // buffer instead of relying on that is the honest fix, not a
        // fragile coincidence of today's boot order.
        const groundTiles = new Array<number>(GRID_WIDTH * GRID_HEIGHT).fill(0);

        const resolveGroundTileTexture = (tileId: number, x: number, y: number): Texture | undefined => {
          if (tileId === WALL_TILE_ID) {
            const bitmask = computeAutotileBitmask(groundTiles, x, y, GRID_WIDTH, GRID_HEIGHT, WALL_TILE_ID);
            return wallTextures.get(bitmask);
          }
          return paletteTextures.get(tileId);
        };

        const layer = new TilemapLayer<Sprite>({
          gridWidth: GRID_WIDTH,
          gridHeight: GRID_HEIGHT,
          tileSize: TILE_SIZE,
          tiles: groundTiles,
          container: host.worldContainer,
          createTileSprite: () => new Sprite(),
          resolveTileTexture: resolveGroundTileTexture,
          zIndex: GROUND_LAYER_Z_INDEX,
        });
        const decorationLayer = new TilemapLayer<Sprite>({
          gridWidth: GRID_WIDTH,
          gridHeight: GRID_HEIGHT,
          tileSize: TILE_SIZE,
          tiles: new Array(GRID_WIDTH * GRID_HEIGHT).fill(0),
          container: host.worldContainer,
          createTileSprite: () => new Sprite(),
          resolveTileTexture: (tileId) => decorationTextures.get(tileId),
          zIndex: DECORATION_LAYER_Z_INDEX,
        });
        rigRef.current = { host, camera, layer, decorationLayer, groundTiles };

        const isWalkable = (worldX: number, worldY: number): boolean => {
          const tileX = Math.floor(worldX / TILE_SIZE);
          const tileY = Math.floor(worldY / TILE_SIZE);
          if (tileX < 0 || tileY < 0 || tileX >= GRID_WIDTH || tileY >= GRID_HEIGHT) return false;
          return layer.getTile(tileX, tileY) !== WALL_TILE_ID;
        };

        const world = new World();
        registerCoreComponents(world);
        const scheduler = new Scheduler(world);
        const snapshots = new TransformSnapshotStore();
        const entityTextures = buildEntityTextures(host.app.renderer, TILE_SIZE);
        const combatEvents = new EventBusImpl<MeleeAttackEventMap>();
        const pickupEvents = new EventBusImpl<PickupEventMap>();
        // I1e: a real @forge/inventory runtime, created once at boot (not
        // rebuilt per scene message the way the dialogue runtime is — an
        // inventory doesn't depend on scene/NPC placements). Unsandboxed,
        // the same documented exception `createModuleRuntime`'s own doc
        // comment already states for `@forge/dialogue`: first-party code
        // Forge itself ships, not a marketplace install.
        const inventoryRuntime = createModuleRuntime("@forge/inventory", { defaultMaxSlots: 20 });
        inventoryModule.setup(inventoryRuntime.ctx);
        const audio = createPreviewAudio();
        previewAudioRef.current = audio;
        scheduler.addSystem(createTransformSnapshotSystem(world, snapshots));
        scheduler.addSystem(createPlayerMovementSystem(world, isWalkable, keysHeldRef.current));
        scheduler.addSystem(
          createMeleeAttackSystem({
            world,
            events: combatEvents,
            consumeAttackRequest: () => {
              const requested = attackRequestedRef.current;
              attackRequestedRef.current = false;
              return requested;
            },
            reach: MELEE_REACH,
            size: MELEE_SIZE,
            damage: MELEE_DAMAGE,
            knockbackSpeed: MELEE_KNOCKBACK_SPEED,
            invulnerabilitySec: MELEE_INVULNERABILITY_SEC,
            flashSec: MELEE_FLASH_SEC,
          }),
        );
        scheduler.addSystem(createKnockbackPhysicsSystem({ world }));
        scheduler.addSystem(
          createEnemyAiSystem({
            world,
            events: combatEvents,
            detectRadius: ENEMY_DETECT_RADIUS,
            attackRange: ENEMY_ATTACK_RANGE,
            attackDamage: ENEMY_ATTACK_DAMAGE,
            attackCooldownSec: ENEMY_ATTACK_COOLDOWN_SEC,
            attackInvulnerabilitySec: ENEMY_ATTACK_INVULNERABILITY_SEC,
            attackFlashSec: ENEMY_ATTACK_FLASH_SEC,
            wanderRadius: ENEMY_WANDER_RADIUS,
            wanderSpeed: ENEMY_WANDER_SPEED,
            isWalkable,
          }),
        );
        scheduler.addSystem(
          createMountSystem({
            world,
            consumeMountRequest: () => {
              const requested = mountRequestedRef.current;
              mountRequestedRef.current = false;
              return requested;
            },
          }),
        );
        scheduler.addSystem(createCharacterAnimationSystem({ world, frameCount: WALK_FRAME_COUNT, fps: WALK_FPS }));
        scheduler.addSystem(
          createEquipmentSystem({
            world,
            consumeEquipRequest: () => {
              const requested = equipRequestedRef.current;
              equipRequestedRef.current = false;
              return requested;
            },
            weaponAssetId: WEAPON_ASSET_ID,
            weaponOffset: WEAPON_OFFSET,
          }),
        );
        scheduler.addSystem(createHitFlashSystem({ world }));
        scheduler.addSystem(createFloatingTextSystem({ world }));
        scheduler.addSystem(createPickupSystem({ world, events: pickupEvents }));
        scheduler.addSystem(createVfxParticleSystem({ world }));
        scheduler.addSystem(
          createSpriteSyncSystem({
            world,
            container: host.worldContainer,
            snapshots,
            createSprite: () => new Sprite(),
            resolveTexture: (assetId: number, frame: number): Texture | undefined => {
              const role = ASSET_ID_TO_CHARACTER_ROLE[assetId];
              const frameSet = role ? characterTexturesRef.current.get(role) : undefined;
              const animatedFrame = frameSet?.frames[frame];
              if (animatedFrame) return animatedFrame;
              if (assetId === COIN_ASSET_ID) return entityTextures.get(COIN_PICKUP_PREFAB.id);
              if (assetId === MOUNT_ASSET_ID) return entityTextures.get(MOUNT_PREFAB.id);
              if (assetId === WEAPON_ASSET_ID) return entityTextures.get(WEAPON_MARKER_TEXTURE_KEY);
              if (assetId === VFX_PARTICLE_ASSET_ID) return entityTextures.get(VFX_PARTICLE_TEXTURE_KEY);
              return entityTextures.get(assetId === PLAYER_ASSET_ID ? "player-start" : "npc");
            },
          }),
        );
        scheduler.addSystem(
          createTextSyncSystem<Text>({
            world,
            container: host.worldContainer,
            createText: () => {
              const text = new Text({ text: "", style: { fill: 0xff5050, fontSize: 14, fontWeight: "bold" } });
              text.anchor.set(0.5, 1);
              return text;
            },
          }),
        );

        combatEvents.on("combat:hit", (payload) => {
          audio.playImpact();
          const targetTransform = world.get<typeof TransformSchema>(payload.target, "Transform");
          if (!targetTransform) return; // defensive: nothing to anchor a floating number/spark to without a live Transform.
          world.create({
            Transform: { x: targetTransform.x, y: targetTransform.y + DAMAGE_NUMBER_SPAWN_OFFSET_Y },
            FloatingText: { value: payload.damage, age: 0, ttl: DAMAGE_NUMBER_TTL_SEC },
          });
          // I1d: a real impact spark on every landed hit, not just a kill —
          // H1d's original ad hoc code only ever fired on death.
          spawnVfxBurst(world, targetTransform.x, targetTransform.y, IMPACT_SPARK_OPTIONS);
          world.flush();
        });
        combatEvents.on("combat:death", (payload) => {
          audio.playDeath();
          spawnVfxBurst(world, payload.x, payload.y, DEATH_BURST_OPTIONS);
          // H1e's item drop: every kill leaves a real, walkable-over coin
          // at the enemy's own last position — not a chance roll (I1's
          // job to decide loot tables), every death drops exactly one.
          spawnCoinPickup(world, payload.x, payload.y);
          world.flush();
        });
        pickupEvents.on("pickup:collected", (payload) => {
          audio.playPickup();
          const itemKey = ITEM_KEY_FOR_ID[payload.itemId];
          if (!itemKey) {
            console.warn(`[forge:preview] picked up an item with no known inventory key (Pickup.itemId ${payload.itemId}) — dropped, not added to inventory.`);
            return;
          }
          // `payload.player` is only ever used here as an opaque storage
          // key (`inv:<entity>`), never dereferenced structurally against
          // this runtime's own isolated World — the same cross-world id
          // reuse `capacityFor`'s own `ctx.world.has(...)` check already
          // tolerates (falls back to `defaultMaxSlots` since nothing was
          // ever created with that id in *this* World either).
          inventoryRuntime.events.emit("inventory:add", { entity: payload.player, itemId: itemKey, qty: payload.amount });
        });
        inventoryRuntime.events.on("inventory:changed", (payload) => {
          // The HUD's single coin slot is still the right-sized UI for a
          // one-item-type game (a real multi-item panel would be
          // speculative UI for content that doesn't exist yet) — now
          // driven by the module's own real running total instead of a
          // parallel, independently-incremented React counter.
          const changed = payload as InventoryChangedEvent;
          if (changed.itemId === "coin") setCoinCount(changed.qty);
        });
        inventoryRuntime.events.on("inventory:rejected", (payload) => {
          // Unreachable in practice today (a single stackable item type
          // never crosses the slot-count capacity check), but a real
          // rejection is a legitimate gameplay outcome, not an error to
          // swallow silently (CLAUDE.md 1.2.11) — logged honestly rather
          // than building a toast/notification UI for a path nothing can
          // currently exercise.
          console.warn("[forge:preview] inventory:add was rejected", payload);
        });

        const demoEnemySpawn = tileCenterWorld(DEMO_ENEMY_TILE.x, DEMO_ENEMY_TILE.y);
        const enemyEntity = spawnEnemy(world, demoEnemySpawn.x, demoEnemySpawn.y);
        world.flush();
        // Test-only, DEV-gated escape hatch: several pre-I1a Playwright
        // specs (damageAndDeath/pickupAndHud/previewAudio) place the
        // player right next to this demo enemy for reasons unrelated to
        // combat AI (event wiring, HUD wiring, audio wiring) — since I1a
        // the enemy now notices and attacks on its own, and no amount of
        // post-boot polling from the test side can reliably outrace its
        // very first tick once a player entity exists. Setting this flag
        // via `page.addInitScript` (before the iframe's own scripts ever
        // run) disarms the enemy's own attack from its first tick, with
        // zero effect on its `Health`/collider — it's still fully
        // damageable by the player's own swings, exactly what those specs
        // need. `enemyAi.spec.ts` is the one spec that deliberately never
        // sets this, since proving the real attack is its whole point.
        // Written after the flush above: `world.set` on a just-created
        // entity requires it to have already been materialized out of the
        // command buffer, the same reason every other spawn helper in this
        // file flushes immediately after creating.
        if (import.meta.env.DEV && (window as unknown as { __forgeTestDisableEnemyAggro?: boolean }).__forgeTestDisableEnemyAggro) {
          world.set(enemyEntity, "EnemyAi", { attackCooldownUntil: Number.MAX_SAFE_INTEGER });
          world.flush();
        }

        const demoMountSpawn = tileCenterWorld(DEMO_MOUNT_TILE.x, DEMO_MOUNT_TILE.y);
        const mountEntity = spawnMount(world, demoMountSpawn.x, demoMountSpawn.y);
        world.flush();

        gameWorldRef.current = {
          world,
          scheduler,
          playerEntity: undefined,
          npcEntitiesByPlacementId: new Map(),
          enemyEntity,
          mountEntity,
          combatEvents,
          pickupEvents,
        };

        const onTick = (ticker: { deltaMS: number }) => {
          scheduler.tick(ticker.deltaMS);
          const playerEntity = gameWorldRef.current?.playerEntity;
          const playerTransform = playerEntity !== undefined ? world.get<typeof TransformSchema>(playerEntity, "Transform") : undefined;
          if (playerTransform) {
            const { width: vw, height: vh } = viewportSizeRef.current;
            camera.zoom = followZoom(vw, vh);
            followCamera(camera, playerTransform.x, playerTransform.y);
            camera.applyTo(host.worldContainer);
            const visibleBounds = camera.visibleWorldBounds(TILE_SIZE);
            layer.cull(visibleBounds);
            decorationLayer.cull(visibleBounds);
          }

          // H1f's footstep cadence: real distance traveled this tick, not
          // wall-clock time, so a step lands the same way regardless of
          // frame rate. Standing still (or blocked by a wall — Velocity
          // reports the *applied* displacement, per createPlayerMovementSystem's
          // own doc comment) resets the accumulator rather than letting a
          // stale partial stride carry into the next walk.
          const playerVelocity = playerEntity !== undefined ? world.get<typeof VelocitySchema>(playerEntity, "Velocity") : undefined;
          if (playerVelocity) {
            const speed = Math.hypot(playerVelocity.vx, playerVelocity.vy);
            if (speed > 0) {
              footstepDistanceRef.current += speed * (ticker.deltaMS / 1000);
              if (footstepDistanceRef.current >= FOOTSTEP_STRIDE_DISTANCE) {
                footstepDistanceRef.current -= FOOTSTEP_STRIDE_DISTANCE;
                audio.playFootstep();
              }
            } else {
              footstepDistanceRef.current = 0;
            }
          }

          // H1e's HUD health bar: direct DOM mutation (this ref-based
          // approach's own doc comment, above, explains why not setState),
          // reading the real live `Health` the moment there's a player to
          // read it from.
          const playerHealth = playerEntity !== undefined ? world.get<typeof HealthSchema>(playerEntity, "Health") : undefined;
          if (playerHealth && healthBarFillRef.current && healthBarRootRef.current) {
            const ratio = playerHealth.max > 0 ? Math.max(0, Math.min(1, playerHealth.current / playerHealth.max)) : 0;
            healthBarFillRef.current.style.width = `${ratio * 100}%`;
            healthBarRootRef.current.setAttribute("aria-valuenow", String(Math.round(playerHealth.current)));
            healthBarRootRef.current.setAttribute("aria-valuemax", String(Math.round(playerHealth.max)));
            if (healthBarLabelRef.current) {
              healthBarLabelRef.current.textContent = `${Math.round(playerHealth.current)}/${Math.round(playerHealth.max)}`;
            }
          }
        };
        tickerCallbackRef.current = onTick;
        host.app.ticker.add(onTick);

        setStatus("ready");
        window.parent.postMessage({ type: "forge:preview:ready" }, TRUSTED_EDITOR_ORIGIN);

        if (import.meta.env.DEV) {
          (
            window as unknown as {
              __forgePreviewDebug?: RenderRig & { gameWorld: GameWorld | null; inventoryRuntime: typeof inventoryRuntime };
            }
          ).__forgePreviewDebug = {
            host,
            camera,
            layer,
            decorationLayer,
            groundTiles,
            gameWorld: gameWorldRef.current,
            inventoryRuntime,
          };
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error("[forge:preview] failed to start the renderer", err);
        setErrorMessage(message);
        setStatus("error");
        window.parent.postMessage({ type: "forge:preview:error", message }, TRUSTED_EDITOR_ORIGIN);
      }
    });
    lifecycleRef.current = bootPromise;

    return () => {
      cancelled = true;
      lifecycleRef.current = bootPromise.then(() => {
        if (tickerCallbackRef.current) rigRef.current?.host.app.ticker.remove(tickerCallbackRef.current);
        rigRef.current?.host.destroy();
        rigRef.current = null;
        gameWorldRef.current = null;
        previewAudioRef.current?.dispose();
        previewAudioRef.current = null;
      });
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const rig = rigRef.current;
      if (!rig || width <= 0 || height <= 0) return;
      viewportSizeRef.current = { width, height };
      rig.host.resize(width, height);
      rig.camera.resizeViewport(width, height);
      // Before a player exists, keep fitting the whole map (same as boot);
      // once one does, the per-tick follow logic (onTick, above) already
      // recomputes zoom and re-clamps every frame regardless of what's set
      // here — this only needs to avoid clobbering that with a stale
      // fit-zoom on a resize that lands between two follow ticks.
      const hasPlayer = gameWorldRef.current?.playerEntity !== undefined;
      rig.camera.zoom = hasPlayer ? followZoom(width, height) : fitZoom(width, height);
      if (!hasPlayer) {
        rig.camera.x = (GRID_WIDTH * TILE_SIZE) / 2;
        rig.camera.y = (GRID_HEIGHT * TILE_SIZE) / 2;
      }
      rig.camera.applyTo(rig.host.worldContainer);
      const visibleBounds = rig.camera.visibleWorldBounds(TILE_SIZE);
      rig.layer.cull(visibleBounds);
      rig.decorationLayer.cull(visibleBounds);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // The scene-data bridge. Tiles are applied straight to the live
  // TilemapLayer, same as before Phase 7. Entities are reconciled against
  // the *persistent* GameWorld (spawn once, never reset an existing
  // player's position on a later message) but the dialogue module is
  // rebuilt fresh every time: config.trees is only ever read once, at
  // dialogueModule.setup(), so there is no way to hand it updated content
  // without a fresh setup() call. Rebuilding costs nothing but an
  // in-progress conversation's DialogueState — an acceptable, documented
  // trade against never being able to see an edited NPC line at all.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== TRUSTED_EDITOR_ORIGIN) return;
      if (!isPreviewSceneMessage(event.data)) {
        const looksLikeOurs =
          typeof event.data === "object" &&
          event.data !== null &&
          typeof (event.data as { type?: unknown }).type === "string" &&
          (event.data as { type: string }).type.startsWith("forge:preview:");
        if (looksLikeOurs) console.warn("[forge:preview] ignored a malformed forge:preview:scene message");
        return;
      }
      const rig = rigRef.current;
      const gameWorld = gameWorldRef.current;
      if (!rig || !gameWorld) return;
      const { tiles, entities, activePack } = event.data;

      // Fire-and-forget, guarded against duplicate/stale loads: most
      // `forge:preview:scene` messages (every tile paint) repeat the same
      // `activePack`, and this only needs to (re)fetch the manifest and
      // slice character textures when it actually changes. Sprite
      // rendering self-heals once `characterTexturesRef` updates — the
      // sprite-sync system above calls `resolveTexture` unconditionally
      // every tick, so no explicit re-render/refresh is needed here.
      if (activePack !== loadedPackNameRef.current) {
        loadedPackNameRef.current = activePack;
        characterTexturesRef.current = new Map(); // clear immediately: don't keep showing the outgoing pack's art while the new one loads.
        void loadActivePackContext(activePack)
          .then((context) => buildPackAwareCharacterTextures(context))
          .then((textures) => {
            if (loadedPackNameRef.current === activePack) characterTexturesRef.current = textures;
          })
          .catch((err) => {
            console.warn("[forge:preview] failed to load character art for the active pack — falling back to placeholder markers.", err);
          });
      }

      // H1g: `rig.groundTiles` is kept in lockstep with `rig.layer`'s own
      // internal copy (mutated here, not just handed to `setTile`) since
      // it's what `resolveGroundTileTexture`'s closure (in the boot
      // effect) reads to compute a Wall cell's own live autotile bitmask.
      let anyGroundChange = false;
      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          const index = y * GRID_WIDTH + x;
          const tileId = tiles[index]!;
          const previousTileId = rig.groundTiles[index];
          if (previousTileId === tileId) continue;

          anyGroundChange = true;
          const wallRelevant = previousTileId === WALL_TILE_ID || tileId === WALL_TILE_ID;
          rig.groundTiles[index] = tileId;
          rig.layer.setTile(x, y, tileId);

          if (wallRelevant) {
            // A wall's own autotile texture depends on its neighbors, so
            // this change can also change up to 4 already-placed
            // neighbors' own textures — re-`setTile`ing each with its
            // own (unchanged) id forces a texture recompute against the
            // now-updated grid without altering what's actually painted
            // there.
            if (y > 0) rig.layer.setTile(x, y - 1, rig.groundTiles[index - GRID_WIDTH]!);
            if (y < GRID_HEIGHT - 1) rig.layer.setTile(x, y + 1, rig.groundTiles[index + GRID_WIDTH]!);
            if (x > 0) rig.layer.setTile(x - 1, y, rig.groundTiles[index - 1]!);
            if (x < GRID_WIDTH - 1) rig.layer.setTile(x + 1, y, rig.groundTiles[index + 1]!);
          }
        }
      }
      if (anyGroundChange) {
        rig.decorationLayer.setTiles(computeDecorationTiles(rig.groundTiles, GRID_WIDTH, GRID_HEIGHT));
      }

      reconcileEntities(gameWorld, entities);
      dialogueRef.current = rebuildDialogueRuntime(entities, (payload) => {
        clearTimeout(bubbleTimeoutRef.current);
        setBubble({ speaker: payload.speaker, text: payload.text });
        bubbleTimeoutRef.current = setTimeout(() => setBubble(null), DIALOGUE_BUBBLE_MS);
      });
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(bubbleTimeoutRef.current);
    };
  }, []);

  // "E" to interact with the nearest NPC in range (or mount/dismount if
  // none is), Space to swing, "R" to equip/unequip the wielded weapon.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // H1f: the first real keypress the preview already requires for
      // focus is also the browser-mandated user gesture that unlocks
      // Web Audio — idempotent, so unconditional here is simplest.
      previewAudioRef.current?.resume();
      keysHeldRef.current.add(event.key);
      if (event.key === MELEE_ATTACK_KEY) {
        event.preventDefault(); // stop the page from scrolling on Space, the same way a real game would capture it
        attackRequestedRef.current = true;
        previewAudioRef.current?.playSwing(); // the whoosh plays on every real swing attempt, hit or miss — matches a real game's weapon sound
        return;
      }
      if (event.key.toLowerCase() === EQUIP_TOGGLE_KEY) {
        equipRequestedRef.current = true;
        return;
      }
      if (event.key.toLowerCase() !== "e") return;
      const gameWorld = gameWorldRef.current;
      if (gameWorld?.playerEntity === undefined) return;
      const dialogue = dialogueRef.current;
      const playerTransform = gameWorld.world.get<typeof TransformSchema>(gameWorld.playerEntity, "Transform");
      if (!playerTransform) return;

      let nearestId: string | undefined;
      let nearestDistance = INTERACT_RANGE;
      if (dialogue) {
        for (const [placementId, npcEntity] of gameWorld.npcEntitiesByPlacementId) {
          if (!dialogue.dialogueEntityByPlacementId.has(placementId)) continue; // no dialogue configured
          const npcTransform = gameWorld.world.get<typeof TransformSchema>(npcEntity, "Transform");
          if (!npcTransform) continue;
          const distance = Math.hypot(playerTransform.x - npcTransform.x, playerTransform.y - npcTransform.y);
          if (distance <= nearestDistance) {
            nearestDistance = distance;
            nearestId = placementId;
          }
        }
      }

      if (nearestId) {
        const dialogueEntity = dialogue!.dialogueEntityByPlacementId.get(nearestId)!;
        dialogue!.runtime.ctx.events.emit("dialogue:start", { entity: dialogueEntity, treeId: nearestId });
        return;
      }

      // No NPC dialogue target in range — I1b's mount/dismount instead.
      // createMountSystem itself decides whether this actually mounts,
      // dismounts, or does nothing (no mount in range and not currently
      // riding one); this is just the same "E was pressed" edge NPC
      // interact already consumes, falling through to a second consumer.
      mountRequestedRef.current = true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keysHeldRef.current.delete(event.key);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  return (
    <div className="fg-preview-app" ref={containerRef}>
      {status === "loading" && (
        <div className="fg-preview-app__overlay" role="status" aria-label="Starting the preview">
          Starting the preview…
        </div>
      )}
      {status === "error" && (
        <div className="fg-preview-app__overlay fg-preview-app__overlay--error" role="alert">
          <p>Couldn&rsquo;t start the preview.</p>
          <p className="fg-preview-app__error-detail">{errorMessage}</p>
        </div>
      )}
      <canvas ref={canvasRef} className="fg-preview-app__surface" />
      <div className="fg-preview-app__hud">
        <div
          className="fg-preview-app__health-bar"
          role="progressbar"
          aria-label="Health"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={100}
          ref={healthBarRootRef}
        >
          <div className="fg-preview-app__health-bar-fill" ref={healthBarFillRef} />
        </div>
        <span className="fg-preview-app__health-bar-label" ref={healthBarLabelRef}>
          100/100
        </span>
        <div className="fg-preview-app__hud-item-slot" aria-label={`Coins collected: ${coinCount}`}>
          <span className="fg-preview-app__hud-item-icon" aria-hidden="true" />
          <span className="fg-preview-app__hud-item-count">{coinCount}</span>
        </div>
      </div>
      {bubble && (
        <div className="fg-preview-app__dialogue" role="status">
          <span className="fg-preview-app__dialogue-speaker">{bubble.speaker}</span>
          <span className="fg-preview-app__dialogue-text">
            <RichDialogueText text={bubble.text} />
          </span>
        </div>
      )}
    </div>
  );
}

function reconcileEntities(gameWorld: GameWorld, entities: readonly EntityPlacement[]): void {
  const { world, npcEntitiesByPlacementId } = gameWorld;

  const playerPlacement = entities.find((entity) => entity.prefabId === "player-start");
  if (playerPlacement && gameWorld.playerEntity === undefined) {
    const { x, y } = tileCenterWorld(playerPlacement.tileX, playerPlacement.tileY);
    gameWorld.playerEntity = spawnPlayer(world, x, y);
  }

  const seenIds = new Set(entities.filter((entity) => entity.prefabId === "npc").map((entity) => entity.id));
  for (const [placementId, entityId] of npcEntitiesByPlacementId) {
    if (seenIds.has(placementId)) continue;
    world.destroy(entityId);
    npcEntitiesByPlacementId.delete(placementId);
  }
  for (const entity of entities) {
    if (entity.prefabId !== "npc") continue;
    const { x, y } = tileCenterWorld(entity.tileX, entity.tileY);
    const existing = npcEntitiesByPlacementId.get(entity.id);
    if (existing === undefined) {
      npcEntitiesByPlacementId.set(entity.id, spawnNpcMarker(world, x, y));
    } else {
      world.set(existing, "Transform", { x, y });
    }
  }

  world.flush();
}

function rebuildDialogueRuntime(
  entities: readonly EntityPlacement[],
  onShown: (payload: { speaker: string; text: string }) => void,
): DialogueRuntime {
  const trees = buildDialogueTreesFromEntities(entities);

  const runtime = createModuleRuntime("@forge/dialogue", { trees });
  dialogueModule.setup(runtime.ctx);
  runtime.events.on("dialogue:shown", (payload) => {
    const { speaker, text } = payload as { speaker: string; text: string };
    onShown({ speaker, text });
  });

  const dialogueEntityByPlacementId = new Map<string, EntityId>();
  for (const tree of trees) {
    dialogueEntityByPlacementId.set(tree.id, runtime.ctx.world.create());
  }
  runtime.world.flush();

  return { runtime, dialogueEntityByPlacementId };
}
