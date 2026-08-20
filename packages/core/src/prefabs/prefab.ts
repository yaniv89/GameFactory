import type { Animator, Collider, Health, Interactable, PlayerControlled, Sprite, Velocity } from "../components/core";
import type { EntityId } from "../ecs/entity";
import type { World } from "../ecs/world";
import { COLLIDER_SHAPE_BOX } from "../physics/aabb";

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
    collider: { shape: 1, width: 0, height: 0, offsetX: 0, offsetY: 0, isTrigger: 0, layer: 0 },
    playerControlled: { inputMapId: 0 },
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
 * H1c's demo combat target — a stationary, damageable, knockback-able
 * entity `createMeleeAttackSystem`/`createKnockbackPhysicsSystem` (and
 * later I1's real AI/wander behavior) act on. `health`'s presence, not a
 * separate tag component, is what those systems query by (this file's own
 * doc comment on `HealthSchema` explains why) — `velocity.friction`
 * is the knockback-recovery decay rate `createKnockbackPhysicsSystem`
 * reads, `maxSpeed: 0` because nothing drives this entity's own movement
 * input yet (no AI/wander system exists before I1).
 */
export const ENEMY_PREFAB: Prefab = {
  id: "enemy",
  label: "Enemy",
  spriteAssetKey: "enemy",
  components: {
    sprite: { frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 },
    animator: {},
    velocity: { vx: 0, vy: 0, maxSpeed: 0, friction: 6 },
    collider: { shape: COLLIDER_SHAPE_BOX, width: 24, height: 24, offsetX: 0, offsetY: 0, isTrigger: 0, layer: 0 },
    health: { current: 30, max: 30, invulnerableUntil: 0, flashUntil: 0 },
  },
};

const PREFAB_REGISTRY: Readonly<Record<string, Prefab>> = {
  [PLAYER_START_PREFAB.id]: PLAYER_START_PREFAB,
  [NPC_PREFAB.id]: NPC_PREFAB,
  [ENEMY_PREFAB.id]: ENEMY_PREFAB,
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
  return world.create(initial);
}
