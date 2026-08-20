import { MOUNT_NO_RIDER, type Animator, type Collider, type EnemyAi, type Health, type Interactable, type Mount, type Pickup, type PlayerControlled, type Sprite, type Velocity } from "../components/core";
import type { EntityId } from "../ecs/entity";
import type { World } from "../ecs/world";
import { COLLIDER_SHAPE_BOX, COLLIDER_SHAPE_CIRCLE } from "../physics/aabb";

/**
 * A named, fixed-shape default bundle of component values — the
 * replacement for a hardcoded `EntityPlacement.kind` union
 * (docs/adr/0015-entity-prefab-component-model.md). Purely an
 * authoring-time convenience: never stored in the ECS or serialized into a
 * scene directly, only referenced by id (`EntityPlacement.prefabId`).
 * Composes only from `@forge/core`'s existing fixed-shape components, per
 * docs/adr/0002-dynamic-shape-components-deferred.md — no open-ended
 * per-instance shape here.
 *
 * Every field a prefab omits from a given component falls back to that
 * component's own registered default (`ComponentRegistry`'s
 * `defaults`, applied by `Archetype.addEntity` before `spawnFromPrefab`'s
 * explicit values are layered on) — the same partial-update mechanism
 * `World.set` already relies on elsewhere (e.g. `gameLogic.ts`'s
 * `world.set(playerEntity, "Transform", { x, y })`), not a second,
 * bespoke defaulting path.
 */
export interface Prefab {
  readonly id: string;
  readonly label: string;
  /**
   * Symbolic art-pack asset key this prefab's sprite resolves to (e.g.
   * `"player"`, `"npc"`) — not a numeric `Sprite.assetId`, which is
   * meaningless without a specific resolved-asset table built per scene
   * load (docs/adr/0015 decision 4). `spawnFromPrefab`'s caller resolves
   * this key against that table, falling back to a placeholder texture
   * when unresolved — the same "renders as a placeholder until remapped"
   * honesty `diffPackSwap` already promises for tiles and character
   * sheets. Omit for a prefab with no `sprite` component.
   */
  readonly spriteAssetKey?: string;
  readonly components: {
    readonly sprite?: Partial<Sprite>;
    readonly animator?: Partial<Animator>;
    readonly collider?: Partial<Collider>;
    readonly velocity?: Partial<Velocity>;
    readonly playerControlled?: Partial<PlayerControlled>;
    readonly interactable?: Partial<Interactable>;
    readonly health?: Partial<Health>;
    readonly pickup?: Partial<Pickup>;
    /**
     * `homeX`/`homeY`/`wanderTargetX`/`wanderTargetY` are never taken from
     * here — `spawnFromPrefab` always sets all four to the entity's own
     * spawn position (there is no sensible static prefab default for
     * "where was I placed," the same reason `Transform.x`/`y` themselves
     * aren't prefab fields). This is only for `attackCooldownUntil`, which
     * every entity should genuinely start at 0 (able to attack
     * immediately) — included for completeness, not because a prefab is
     * expected to override it.
     */
    readonly enemyAi?: Partial<EnemyAi>;
    /**
     * `riderEntity`/`riderBaseMaxSpeed` are never taken from here —
     * `spawnFromPrefab` always sets `riderEntity` to `MOUNT_NO_RIDER` (a
     * freshly spawned mount is never pre-ridden) and `riderBaseMaxSpeed`
     * to 0 (meaningless until something actually mounts it). This is only
     * for `range`/`mountedMaxSpeed`, the per-prefab tuning a mount
     * genuinely differs on.
     */
    readonly mount?: Partial<Mount>;
  };
}

/**
 * First-party prefabs only (docs/adr/0015 decision 3) — no third-party
 * registration extension point yet; that is separate, later work needing
 * its own Module API ADR per CLAUDE.md 3.1, not decided here.
 *
 * These two reproduce, field for field, what `spawnPlayer`/`spawnNpcMarker`
 * hardcoded before this prefab model existed (`packages/player/src/gameWorld.ts`,
 * `packages/editor/src/preview/gameWorld.ts`) — the migration from
 * `kind: "player-start" | "npc"` to `prefabId` changes no rendered pixel
 * and no spawned component value.
 */
export const PLAYER_START_PREFAB: Prefab = {
  id: "player-start",
  label: "Player start",
  spriteAssetKey: "player",
  components: {
    sprite: { frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 },
    animator: {},
    velocity: { vx: 0, vy: 0, maxSpeed: 140, friction: 0 },
    // A real (non-zero) radius, unlike before H1e: tile-grid movement
    // collision (`createPlayerMovementSystem`'s own doc comment) never
    // read this collider, so its width/height sat at 0 harmlessly, but
    // `createPickupSystem`'s AABB overlap test needs a genuine hit area to
    // detect walking over a dropped item.
    collider: { shape: COLLIDER_SHAPE_CIRCLE, width: 20, height: 20, offsetX: 0, offsetY: 0, isTrigger: 0, layer: 0 },
    playerControlled: { inputMapId: 0 },
    // Real, live ECS state the HUD health bar reads every tick — not a
    // fake/decorative number. Nothing in this vertical slice damages the
    // player yet (no enemy AI exists before I1), the same stated,
    // presently-unexercised-but-genuinely-wired gap `ENEMY_PREFAB`'s own
    // `velocity.maxSpeed: 0` doc comment already accepts for the enemy's
    // own movement.
    health: { current: 100, max: 100, invulnerableUntil: 0, flashUntil: 0 },
  },
};

export const NPC_PREFAB: Prefab = {
  id: "npc",
  label: "NPC",
  spriteAssetKey: "npc",
  components: {
    sprite: { frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 },
    animator: {},
  },
};

/**
 * H1c's demo combat target — a damageable, knockback-able entity
 * `createMeleeAttackSystem`/`createKnockbackPhysicsSystem` act on.
 * `health`'s presence, not a separate tag component, is what those
 * systems query by (this file's own doc comment on `HealthSchema`
 * explains why) — `velocity.friction` is the knockback-recovery decay
 * rate `createKnockbackPhysicsSystem` reads. `maxSpeed` is now non-zero
 * (I1a): `createEnemyAiSystem` is what drives this entity's own movement
 * input, slower than the player's own 140 so a player who chooses to can
 * out-run/kite it rather than always being forced to fight in place.
 */
export const ENEMY_PREFAB: Prefab = {
  id: "enemy",
  label: "Enemy",
  spriteAssetKey: "enemy",
  components: {
    sprite: { frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 },
    animator: {},
    velocity: { vx: 0, vy: 0, maxSpeed: 90, friction: 6 },
    collider: { shape: COLLIDER_SHAPE_BOX, width: 24, height: 24, offsetX: 0, offsetY: 0, isTrigger: 0, layer: 0 },
    health: { current: 30, max: 30, invulnerableUntil: 0, flashUntil: 0 },
    enemyAi: {},
  },
};

/** H1e's only defined item, referenced by `COIN_PICKUP_PREFAB.components.pickup.itemId` and (out of band, per `PickupSchema`'s own doc comment) by the editor preview's HUD slot counter. */
export const COIN_ITEM_ID = 1;

/**
 * H1e's world item — spawned by the editor preview at a killed enemy's own
 * position (`combat:death`'s payload), not player-authored, the same
 * "not sourced from scene placements yet" gap `ENEMY_PREFAB`'s own doc
 * comment already states for the enemy itself. `collider.isTrigger: 1`
 * marks it as a non-solid overlap target — `createPickupSystem` tests
 * overlap the same narrow-phase way `createMeleeAttackSystem` tests a
 * swing, but nothing needs this collider to block movement the way
 * `ENEMY_PREFAB`'s own (non-trigger) collider does.
 */
export const COIN_PICKUP_PREFAB: Prefab = {
  id: "coin-pickup",
  label: "Coin",
  spriteAssetKey: "coin",
  components: {
    sprite: { frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 },
    collider: { shape: COLLIDER_SHAPE_CIRCLE, width: 16, height: 16, offsetX: 0, offsetY: 0, isTrigger: 1, layer: 0 },
    pickup: { itemId: COIN_ITEM_ID, amount: 1 },
  },
};

/**
 * I1b's rideable entity — no `Collider`, matching `NPC_PREFAB`'s own
 * precedent: `createMountSystem` does its own direct distance check (the
 * same shape `INTERACT_RANGE`'s NPC-dialogue lookup already uses in the
 * editor preview), not an AABB overlap test, so nothing reads this
 * entity's collider. `mountedMaxSpeed` (260) comfortably exceeds
 * `PLAYER_START_PREFAB.components.velocity.maxSpeed` (140) so riding is a
 * genuine, felt speed boost, not a marginal one.
 */
export const MOUNT_PREFAB: Prefab = {
  id: "mount",
  label: "Mount",
  spriteAssetKey: "mount",
  components: {
    sprite: { frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 },
    mount: { range: 40, mountedMaxSpeed: 260 },
  },
};

const PREFAB_REGISTRY: Readonly<Record<string, Prefab>> = {
  [PLAYER_START_PREFAB.id]: PLAYER_START_PREFAB,
  [NPC_PREFAB.id]: NPC_PREFAB,
  [ENEMY_PREFAB.id]: ENEMY_PREFAB,
  [COIN_PICKUP_PREFAB.id]: COIN_PICKUP_PREFAB,
  [MOUNT_PREFAB.id]: MOUNT_PREFAB,
};

/**
 * Every registered prefab id — the known-good set a cross-origin wire
 * validator checks a `prefabId` against instead of a closed TypeScript
 * union (`packages/editor/src/preview/protocol.ts`, docs/adr/0015 decision
 * 6), and what an entity-placement UI lists from.
 */
export const PREFAB_IDS: readonly string[] = Object.keys(PREFAB_REGISTRY);

export function getPrefab(id: string): Prefab | undefined {
  return PREFAB_REGISTRY[id];
}

export function isPrefabId(value: unknown): value is string {
  return typeof value === "string" && value in PREFAB_REGISTRY;
}

/**
 * Expands `prefab.components` into a real entity via `World.create` —
 * the one place this expansion happens, so `packages/player/src/gameWorld.ts`
 * and `packages/editor/src/preview/gameWorld.ts` (previously two
 * hand-written, independently-maintained copies of `spawnPlayer`/
 * `spawnNpcMarker`) share one implementation instead of drifting.
 *
 * `resolveSpriteAssetId` is a caller-supplied callback, not a lookup this
 * function does itself: `@forge/core` has no notion of "which numeric
 * asset id a sprite key resolves to today" — that is a rendering-package
 * concern (today, which baked placeholder texture; once L1–L5 land, which
 * Art Pack asset), and stays one, per docs/adr/0015 decision 4.
 */
export function spawnFromPrefab(
  world: World,
  prefab: Prefab,
  worldX: number,
  worldY: number,
  resolveSpriteAssetId: (spriteAssetKey: string) => number,
): EntityId {
  const initial: Record<string, Record<string, number>> = {
    Transform: { x: worldX, y: worldY, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  };
  const c = prefab.components;
  if (c.sprite) {
    initial.Sprite = {
      assetId: prefab.spriteAssetKey ? resolveSpriteAssetId(prefab.spriteAssetKey) : -1,
      ...c.sprite,
    };
  }
  if (c.velocity) initial.Velocity = { ...c.velocity };
  if (c.collider) initial.Collider = { ...c.collider };
  if (c.playerControlled) initial.PlayerControlled = { ...c.playerControlled };
  if (c.animator) initial.Animator = { ...c.animator };
  if (c.interactable) initial.Interactable = { ...c.interactable };
  if (c.health) initial.Health = { ...c.health };
  if (c.pickup) initial.Pickup = { ...c.pickup };
  if (c.enemyAi) {
    // homeX/homeY/wanderTargetX/wanderTargetY always come from the spawn
    // position itself, never the prefab — see this field's own doc
    // comment on `Prefab.components.enemyAi`.
    initial.EnemyAi = { homeX: worldX, homeY: worldY, wanderTargetX: worldX, wanderTargetY: worldY, attackCooldownUntil: 0, ...c.enemyAi };
  }
  if (c.mount) {
    // riderEntity/riderBaseMaxSpeed always start unridden — see this
    // field's own doc comment on `Prefab.components.mount`.
    initial.Mount = { riderEntity: MOUNT_NO_RIDER, range: 40, mountedMaxSpeed: 0, riderBaseMaxSpeed: 0, ...c.mount };
  }
  return world.create(initial);
}
