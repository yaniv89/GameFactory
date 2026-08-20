import { HealthSchema, TransformSchema, VelocitySchema } from "../components/core";
import type { Query } from "../ecs/query";
import type { SystemDefinition } from "../scheduler/system";
import type { World } from "../ecs/world";

/** Below this speed (world units/sec), residual knockback velocity snaps to zero rather than decaying asymptotically forever. */
const STOP_THRESHOLD = 0.5;

export interface KnockbackPhysicsSystemOptions {
  world: World;
}

/**
 * Integrates `Velocity` into `Transform`, with exponential friction decay
 * (`Velocity.friction`, 1/seconds), for every non-player entity carrying
 * `[Transform, Velocity, Health]` — today, `ENEMY_PREFAB` entities
 * (`Health`'s presence, not a separate tag, is the query filter — see that
 * schema's own doc comment). Deliberately not a general-purpose movement
 * system: the player's own `createPlayerMovementSystem` (editor-preview/
 * player packages) already integrates the player straight from held-key
 * input, and running both over the same entity would double-apply
 * displacement.
 *
 * Since H1e gave `PLAYER_START_PREFAB` its own `Health` (for the HUD
 * health bar), `Health`'s presence alone can no longer be the exclusion —
 * the player now legitimately has one. The explicit `PlayerControlled`
 * check below is what keeps this system from ever matching the player;
 * `knockbackPhysics.test.ts` covers both the historical "player has no
 * Health" shape and the current "player has Health but is still excluded"
 * shape so this guard can't silently regress either way.
 *
 * Deliberately does not resolve collision against walls/tiles: a knocked-
 * back entity can be shoved through a wall in this slice. A stated,
 * accepted simplification, not a silent gap — real per-entity collision
 * response against the tilemap is later work, not this hit-reaction
 * primitive's job.
 *
 * I1a gave enemies their own `createEnemyAiSystem`, which actively drives
 * `Transform`/`Velocity` every tick once an entity is no longer within its
 * own `Health.invulnerableUntil` hit-stun window — exactly the same
 * "two systems fighting over one Transform" hazard the `PlayerControlled`
 * exclusion above already guards against. An `EnemyAi`-carrying entity
 * whose invulnerability has already expired is excluded here too, so
 * `createEnemyAiSystem` gets sole, immediate control the instant hit-stun
 * ends rather than fighting this system's own decaying residual velocity
 * for the rest of its natural decay — a deliberate "hit-stun duration
 * bounds the knockback" simplification, not an accident.
 */
export function createKnockbackPhysicsSystem(options: KnockbackPhysicsSystemOptions): SystemDefinition {
  const { world } = options;
  return {
    id: "core:KnockbackPhysics",
    phase: "PostUpdate",
    before: ["core:CharacterAnimation"],
    query: ["Transform", "Velocity", "Health"],
    run: (ctx, entities: Query) => {
      entities.forEach((entity) => {
        if (world.has(entity, "PlayerControlled")) return;
        const health = world.get<typeof HealthSchema>(entity, "Health");
        if (world.has(entity, "EnemyAi") && health && ctx.elapsed >= health.invulnerableUntil) return;
        const transform = world.get<typeof TransformSchema>(entity, "Transform");
        const velocity = world.get<typeof VelocitySchema>(entity, "Velocity");
        if (!transform || !velocity) return;
        if (velocity.vx === 0 && velocity.vy === 0) return;

        world.set(entity, "Transform", { x: transform.x + velocity.vx * ctx.dt, y: transform.y + velocity.vy * ctx.dt });

        const decay = Math.exp(-velocity.friction * ctx.dt);
        const vx = velocity.vx * decay;
        const vy = velocity.vy * decay;
        world.set(entity, "Velocity", {
          vx: Math.abs(vx) < STOP_THRESHOLD ? 0 : vx,
          vy: Math.abs(vy) < STOP_THRESHOLD ? 0 : vy,
        });
      });
    },
  };
}
