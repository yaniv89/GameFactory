import type { ComponentSchema, ComponentValue } from "../ecs/component";
import type { World } from "../ecs/world";

/**
 * Core component schemas, per docs/SPEC.md Section 4.3. Registered against
 * a World via `registerCoreComponents(world)` — components are core-owned
 * data only; the systems that act on them (movement integration, collision
 * resolution, rendering) are `@forge/render-2d` and later phases, not this
 * file.
 *
 * `Stats` (docs/SPEC.md 4.3) is deliberately not here — see
 * docs/adr/0002-dynamic-shape-components-deferred.md for why its
 * open-ended `Record<string, number>` shape doesn't fit the fixed-schema
 * archetype model yet, and what M3 needs to decide before it can.
 */

export const TransformSchema = {
  x: "f64",
  y: "f64",
  z: "f64",
  rotation: "f64",
  scaleX: "f64",
  scaleY: "f64",
} as const satisfies ComponentSchema;
export type Transform = ComponentValue<typeof TransformSchema>;

export const SpriteSchema = {
  assetId: "i32",
  frame: "i32",
  anchorX: "f32",
  anchorY: "f32",
  tint: "u32",
  opacity: "f32",
} as const satisfies ComponentSchema;
export type Sprite = ComponentValue<typeof SpriteSchema>;

export const AnimatorSchema = {
  clipId: "i32",
  playing: "bool",
  speed: "f32",
  loop: "bool",
  elapsed: "f32",
  /** Facing direction, row index into a directional sprite sheet: 0=south, 1=west, 2=east, 3=north. Holds its last value while idle (Velocity magnitude ~0) — see `createCharacterAnimationSystem`. */
  facing: "u8",
} as const satisfies ComponentSchema;
export type Animator = ComponentValue<typeof AnimatorSchema>;

/** shape: 0 = box, 1 = circle. layer/isTrigger are integers (bool as 0/1). */
export const ColliderSchema = {
  shape: "u8",
  width: "f32",
  height: "f32",
  offsetX: "f32",
  offsetY: "f32",
  isTrigger: "bool",
  layer: "u8",
} as const satisfies ComponentSchema;
export type Collider = ComponentValue<typeof ColliderSchema>;

export const VelocitySchema = {
  vx: "f32",
  vy: "f32",
  maxSpeed: "f32",
  friction: "f32",
} as const satisfies ComponentSchema;
export type Velocity = ComponentValue<typeof VelocitySchema>;

/** inputMapId indexes into a project's input map table (docs/SPEC.md 7.3 settings.inputMaps). */
export const PlayerControlledSchema = {
  inputMapId: "i32",
} as const satisfies ComponentSchema;
export type PlayerControlled = ComponentValue<typeof PlayerControlledSchema>;

/**
 * promptText and graphId are string data in the full spec but this
 * component's *numeric* fields (range) live in the archetype columns;
 * string/id lookups are resolved through the asset/graph tables by
 * promptTextId / graphId, kept here as integer references (i32), matching
 * the "components must be serializable, no strings-as-typed-array-cells"
 * constraint of the archetype storage model.
 */
export const InteractableSchema = {
  promptTextId: "i32",
  range: "f32",
  graphId: "i32",
} as const satisfies ComponentSchema;
export type Interactable = ComponentValue<typeof InteractableSchema>;

/**
 * Marks an entity as damageable — H1c's combat slice (`createMeleeAttackSystem`,
 * `createKnockbackPhysicsSystem`) queries entities by this component's mere
 * presence rather than a separate "is this an enemy" tag, the same way
 * `PlayerControlled`'s presence (not a boolean flag on some other
 * component) already marks the player. `invulnerableUntil`/`flashUntil`
 * are both `TickContext.elapsed` timestamps (seconds since the world
 * started, per `TickContext`'s own doc comment) a system compares against
 * directly — no separate timer/countdown bookkeeping needed.
 */
export const HealthSchema = {
  current: "f32",
  max: "f32",
  /** Damage is ignored while `elapsed < invulnerableUntil` — the i-frames a hit grants against being re-hit by the same or an overlapping swing. */
  invulnerableUntil: "f32",
  /** The struck sprite tints red while `elapsed < flashUntil` (`createHitFlashSystem`), reverting to its normal tint once elapsed passes it. */
  flashUntil: "f32",
} as const satisfies ComponentSchema;
export type Health = ComponentValue<typeof HealthSchema>;

/**
 * H1d's floating damage number — a standalone entity `createMeleeAttackSystem`'s
 * `"combat:hit"` listener spawns (renderer-owned, not `spawnFromPrefab`'d:
 * there's no player-authored prefab for a transient combat-log popup),
 * aged and destroyed by `createFloatingTextSystem`, drawn by
 * `@forge/render-2d`'s `createTextSyncSystem`. `age`/`ttl` are seconds,
 * not `TickContext.elapsed` timestamps — unlike `Health`'s fields, a
 * floating number's lifetime is relative to when *it* spawned, not the
 * world's start.
 */
export const FloatingTextSchema = {
  /** The number to display — always shown with a leading "-" (H1d's only user: damage taken). */
  value: "f32",
  age: "f32",
  ttl: "f32",
} as const satisfies ComponentSchema;
export type FloatingText = ComponentValue<typeof FloatingTextSchema>;

/**
 * I1d's VFX particle — a standalone entity `spawnVfxBurst` creates (a
 * handful at once, one per particle: `@forge/core` components have no
 * array fields, per docs/adr/0002-dynamic-shape-components-deferred.md,
 * so a "burst" is genuinely N sibling entities, not one entity holding N
 * directions), aged, moved, and faded by `createVfxParticleSystem`, drawn
 * by the ordinary `[Transform, Sprite]` sprite-sync path every other
 * visible entity already uses — no bespoke render-2d system needed, unlike
 * `FloatingText`'s own `Text`-specific one. `age`/`ttl` are seconds
 * relative to when *this particle* spawned, the same shape `FloatingText`'s
 * own fields already establish.
 */
export const VfxParticleSchema = {
  age: "f32",
  ttl: "f32",
} as const satisfies ComponentSchema;
export type VfxParticle = ComponentValue<typeof VfxParticleSchema>;

/**
 * H1e's world item — a standalone entity marking itself collectible on
 * contact with a `PlayerControlled` entity (`createPickupSystem` queries by
 * this component's mere presence, the same "presence is the tag" pattern
 * `Health`/`PlayerControlled` already establish). `itemId` is a numeric
 * placeholder tag, not yet backed by a real item-definition table (I1's
 * job) — today the only producer (`COIN_PICKUP_PREFAB`) and the only
 * consumer (the editor preview's HUD slot counter) agree on what `1` means
 * out of band, exactly the same "no real registry yet" honesty
 * `Sprite.assetId`'s own doc comment already accepts for sprites.
 */
export const PickupSchema = {
  itemId: "i32",
  amount: "i32",
} as const satisfies ComponentSchema;
export type Pickup = ComponentValue<typeof PickupSchema>;

/**
 * I1a's enemy AI state — presence marks an entity as AI-driven (queried by
 * `createEnemyAiSystem`, the same "presence is the tag" pattern `Health`/
 * `PlayerControlled` already establish), and its fields are the *per-entity*
 * state a shared behavior needs to persist between ticks: where to return
 * to when idle (`homeX`/`homeY`, set once at spawn), the current wander
 * destination, and the next tick this entity is allowed to land another
 * attack. Tuning that's the same for every AI entity today (detect radius,
 * attack damage, cooldown length, speeds) lives in `createEnemyAiSystem`'s
 * own options instead of here, the same split `createMeleeAttackSystem`
 * already draws between per-entity `Health` fields and system-level attack
 * tuning.
 */
export const EnemyAiSchema = {
  homeX: "f32",
  homeY: "f32",
  wanderTargetX: "f32",
  wanderTargetY: "f32",
  /** `TickContext.elapsed` timestamp — the next tick this entity may land another attack, the same "compare elapsed directly, no countdown bookkeeping" shape `Health.invulnerableUntil` already uses. */
  attackCooldownUntil: "f32",
} as const satisfies ComponentSchema;
export type EnemyAi = ComponentValue<typeof EnemyAiSchema>;

/**
 * `Mount.riderEntity` sentinel meaning "not currently ridden." `riderEntity`
 * is stored as `u32` (not `i32`): a packed `EntityId` (generation << 20 |
 * index, see `ecs/entity.ts`) can exceed the signed 32-bit range once a
 * slot's generation climbs past ~2048, and this codebase's other "no
 * value" sentinels (`Sprite.assetId: -1`, `Animator.clipId: -1`) all live
 * in genuinely signed fields where -1 is unambiguous — a `u32` field has
 * no such spare bit, so this uses the type's own max value instead, a
 * packed id no real entity can ever reach in practice.
 */
export const MOUNT_NO_RIDER = 0xffffffff;

/**
 * I1b's rideable entity — presence marks an entity as mountable (queried
 * by `createMountSystem`, the same "presence is the tag" pattern `Health`/
 * `EnemyAi` already establish). `range` and `mountedMaxSpeed` are
 * per-entity so different mount prefabs (a slow ox cart vs. a fast horse)
 * can differ; `riderEntity`/`riderBaseMaxSpeed` are the *live* ride state
 * — `riderBaseMaxSpeed` captures the rider's own `Velocity.maxSpeed` at
 * the moment of mounting so dismounting can restore exactly that value
 * without `createMountSystem` needing to know any rider's "normal" speed
 * ahead of time.
 */
export const MountSchema = {
  riderEntity: "u32",
  range: "f32",
  mountedMaxSpeed: "f32",
  riderBaseMaxSpeed: "f32",
} as const satisfies ComponentSchema;
export type Mount = ComponentValue<typeof MountSchema>;

/** `Equipment.weaponEntity` sentinel meaning "nothing wielded" — same `u32`-max-value reasoning as `MOUNT_NO_RIDER`'s own doc comment. */
export const EQUIPMENT_NO_WEAPON = 0xffffffff;

/**
 * I1c's wielded-weapon state — presence marks an entity as able to equip
 * something (today, only `PLAYER_START_PREFAB`). `weaponEntity` is the
 * live visual entity `createEquipmentSystem` creates on equip and
 * destroys on unequip (`EQUIPMENT_NO_WEAPON` when bare-handed) — not a
 * reference into a real inventory, which doesn't exist yet (I1e's job);
 * this is a stated, honest scope boundary, not an oversight. Equipping
 * affects only the wielded-weapon *visual* today — `createMeleeAttackSystem`
 * itself is not gated on it, so a bare-handed swing still connects,
 * matching every already-shipped combat spec's own assumption; real
 * weapon-damage/reach itemization is later I1 work, not this slice.
 */
export const EquipmentSchema = {
  weaponEntity: "u32",
} as const satisfies ComponentSchema;
export type Equipment = ComponentValue<typeof EquipmentSchema>;

export interface CoreComponents {
  readonly Transform: ReturnType<World["defineComponent"]>;
  readonly Sprite: ReturnType<World["defineComponent"]>;
  readonly Animator: ReturnType<World["defineComponent"]>;
  readonly Collider: ReturnType<World["defineComponent"]>;
  readonly Velocity: ReturnType<World["defineComponent"]>;
  readonly PlayerControlled: ReturnType<World["defineComponent"]>;
  readonly Interactable: ReturnType<World["defineComponent"]>;
  readonly Health: ReturnType<World["defineComponent"]>;
  readonly FloatingText: ReturnType<World["defineComponent"]>;
  readonly VfxParticle: ReturnType<World["defineComponent"]>;
  readonly Pickup: ReturnType<World["defineComponent"]>;
  readonly EnemyAi: ReturnType<World["defineComponent"]>;
  readonly Mount: ReturnType<World["defineComponent"]>;
  readonly Equipment: ReturnType<World["defineComponent"]>;
}

/** Registers every core component against `world`. Call once, at world construction. */
export function registerCoreComponents(world: World): CoreComponents {
  return {
    Transform: world.defineComponent("Transform", TransformSchema, {
      x: 0,
      y: 0,
      z: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
    }),
    Sprite: world.defineComponent("Sprite", SpriteSchema, {
      assetId: -1,
      frame: 0,
      anchorX: 0.5,
      anchorY: 0.5,
      tint: 0xffffff,
      opacity: 1,
    }),
    Animator: world.defineComponent("Animator", AnimatorSchema, {
      clipId: -1,
      playing: 0,
      speed: 1,
      loop: 1,
      elapsed: 0,
      facing: 0,
    }),
    Collider: world.defineComponent("Collider", ColliderSchema, {
      shape: 0,
      width: 32,
      height: 32,
      offsetX: 0,
      offsetY: 0,
      isTrigger: 0,
      layer: 0,
    }),
    Velocity: world.defineComponent("Velocity", VelocitySchema, {
      vx: 0,
      vy: 0,
      maxSpeed: 0,
      friction: 0,
    }),
    PlayerControlled: world.defineComponent("PlayerControlled", PlayerControlledSchema, {
      inputMapId: 0,
    }),
    Interactable: world.defineComponent("Interactable", InteractableSchema, {
      promptTextId: -1,
      range: 32,
      graphId: -1,
    }),
    Health: world.defineComponent("Health", HealthSchema, {
      current: 0,
      max: 0,
      invulnerableUntil: 0,
      flashUntil: 0,
    }),
    FloatingText: world.defineComponent("FloatingText", FloatingTextSchema, {
      value: 0,
      age: 0,
      ttl: 0.8,
    }),
    VfxParticle: world.defineComponent("VfxParticle", VfxParticleSchema, {
      age: 0,
      ttl: 0.5,
    }),
    Pickup: world.defineComponent("Pickup", PickupSchema, {
      itemId: -1,
      amount: 0,
    }),
    EnemyAi: world.defineComponent("EnemyAi", EnemyAiSchema, {
      homeX: 0,
      homeY: 0,
      wanderTargetX: 0,
      wanderTargetY: 0,
      attackCooldownUntil: 0,
    }),
    Mount: world.defineComponent("Mount", MountSchema, {
      riderEntity: MOUNT_NO_RIDER,
      range: 40,
      mountedMaxSpeed: 260,
      riderBaseMaxSpeed: 0,
    }),
    Equipment: world.defineComponent("Equipment", EquipmentSchema, {
      weaponEntity: EQUIPMENT_NO_WEAPON,
    }),
  };
}
