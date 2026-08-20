import { FloatingTextSchema, TransformSchema } from "../components/core";
import type { Query } from "../ecs/query";
import type { SystemDefinition } from "../scheduler/system";
import type { World } from "../ecs/world";

export interface FloatingTextSystemOptions {
  world: World;
  /** World units/sec the text drifts upward while alive. */
  riseSpeed?: number;
}

/**
 * Ages and removes every `[Transform, FloatingText]` entity — H1d's
 * floating damage numbers, spawned by `createMeleeAttackSystem`'s
 * `"combat:hit"` listener (the renderer, not this system: there is no
 * player-authored prefab for a transient combat-log popup). Drifts each
 * one upward at a constant rate and destroys it once `age` passes `ttl`;
 * `@forge/render-2d`'s `createTextSyncSystem` reads `age`/`ttl` to fade
 * it out over that same window, so the two stay in lockstep without
 * either owning the other's state.
 */
export function createFloatingTextSystem(options: FloatingTextSystemOptions): SystemDefinition {
  const { world, riseSpeed = 40 } = options;
  return {
    id: "core:FloatingText",
    phase: "PostUpdate",
    query: ["Transform", "FloatingText"],
    run: (ctx, entities: Query) => {
      entities.forEach((entity) => {
        const floatingText = world.get<typeof FloatingTextSchema>(entity, "FloatingText");
        const transform = world.get<typeof TransformSchema>(entity, "Transform");
        if (!floatingText || !transform) return;

        const age = floatingText.age + ctx.dt;
        if (age >= floatingText.ttl) {
          world.destroy(entity);
          return;
        }
        world.set(entity, "FloatingText", { age });
        world.set(entity, "Transform", { y: transform.y - riseSpeed * ctx.dt });
      });
    },
  };
}
