import { TransformSchema, VelocitySchema, VfxParticleSchema } from "../components/core";
import type { Query } from "../ecs/query";
import type { SystemDefinition } from "../scheduler/system";
import type { World } from "../ecs/world";

export interface VfxParticleSystemOptions {
  world: World;
}

/**
 * I1d's hit-effect pipeline, ages/moves/fades every `[Transform, Velocity,
 * Sprite, VfxParticle]` entity — the ECS-owned replacement for H1d's
 * original ad hoc death-burst (raw `Pixi.Graphics` state living directly
 * in `PreviewApp.tsx`, updated by hand outside the scheduler). Particles
 * fly in a straight line at whatever velocity `spawnVfxBurst` gave them
 * (no friction — `Velocity.maxSpeed`/`friction` are unused here, the
 * fields exist only because `Velocity` is a shared component, the same
 * "some fields don't apply to every consumer" shape `createEnemyAiSystem`'s
 * own reuse of `Health` already accepts) and fade `Sprite.opacity` linearly
 * to 0 over their own `ttl`, matching `createTextSyncSystem`'s own
 * `1 - age/ttl` fade curve for `FloatingText` exactly, so damage numbers
 * and hit sparks fade at the same felt rate.
 */
export function createVfxParticleSystem(options: VfxParticleSystemOptions): SystemDefinition {
  const { world } = options;
  return {
    id: "core:VfxParticle",
    phase: "PostUpdate",
    query: ["Transform", "Velocity", "Sprite", "VfxParticle"],
    run: (ctx, entities: Query) => {
      entities.forEach((entity) => {
        const particle = world.get<typeof VfxParticleSchema>(entity, "VfxParticle");
        const transform = world.get<typeof TransformSchema>(entity, "Transform");
        const velocity = world.get<typeof VelocitySchema>(entity, "Velocity");
        if (!particle || !transform || !velocity) return;

        const age = particle.age + ctx.dt;
        if (age >= particle.ttl) {
          world.destroy(entity);
          return;
        }
        world.set(entity, "VfxParticle", { age });
        world.set(entity, "Transform", { x: transform.x + velocity.vx * ctx.dt, y: transform.y + velocity.vy * ctx.dt });
        world.set(entity, "Sprite", { opacity: Math.max(0, 1 - age / particle.ttl) });
      });
    },
  };
}

export interface VfxBurstOptions {
  /** Number of sibling particle entities to spawn — a "burst" is genuinely N entities, not one entity with N directions (no array fields in this ECS's fixed-shape components). */
  count: number;
  minSpeed: number;
  maxSpeed: number;
  /** Seconds each particle lives before `createVfxParticleSystem` destroys it. */
  ttl: number;
  /** `Sprite.tint` for every particle — a raw numeric color, not a sprite-asset-key lookup (unlike `Sprite.assetId`, no rendering-package resolution is needed for a plain tint, per docs/adr/0015 decision 4). */
  tint: number;
  /** Pre-resolved numeric `Sprite.assetId` for the particle texture — the caller resolves this ahead of time, the same way `createEquipmentSystem`'s own `weaponAssetId` option already works. */
  particleAssetId: number;
}

/**
 * Spawns a burst of `VfxParticle` entities radiating out from `(x, y)` at
 * evenly-spaced angles (with jitter, so a burst doesn't look mechanically
 * uniform), each at a random speed within `[minSpeed, maxSpeed]`. Does not
 * call `world.flush()` itself — same convention every other one-shot spawn
 * helper here follows (`spawnCoinPickup`, `spawnFromPrefab`): the caller
 * flushes once after everything it wants spawned this event.
 */
export function spawnVfxBurst(world: World, x: number, y: number, options: VfxBurstOptions): void {
  const { count, minSpeed, maxSpeed, ttl, tint, particleAssetId } = options;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * ((Math.PI * 2) / count);
    const speed = minSpeed + Math.random() * (maxSpeed - minSpeed);
    world.create({
      Transform: { x, y, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      Velocity: { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, maxSpeed: 0, friction: 0 },
      Sprite: { assetId: particleAssetId, frame: 0, anchorX: 0.5, anchorY: 0.5, tint, opacity: 1 },
      VfxParticle: { age: 0, ttl },
    });
  }
}

