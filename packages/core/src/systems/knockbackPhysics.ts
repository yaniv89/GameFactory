import { TransformSchema, VelocitySchema } from "../components/core";
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
 * (`Velocity.friction`, 1/seconds), for every entity carrying `[Transform,
 * Velocity, Health]` — today, only `ENEMY_PREFAB` entities (`Health`'s
 * presence, not a separate tag, is the query filter — see that schema's
 * own doc comment). Deliberately not a general-purpose movement system:
 * the player's own `createPlayerMovementSystem` (editor-preview/player
 * packages) already integrates the player straight from held-key input,
 * and running both over the same entity would double-apply displacement —
 * `Health` is exactly what keeps this system from ever matching the
 * player, since the player prefab has no `Health` component (yet).
 *
 * Deliberately does not resolve collision against walls/tiles: a knocked-
 * back entity can be shoved through a wall in this slice. A stated,
 * accepted simplification, not a silent gap — real per-entity collision
 * response against the tilemap is I1's "combat, AI" breadth work, not
 * this hit-reaction primitive's job.
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
