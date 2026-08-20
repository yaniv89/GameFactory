import { HealthSchema } from "../components/core";
import type { Query } from "../ecs/query";
import type { SystemDefinition } from "../scheduler/system";
import type { World } from "../ecs/world";

export interface HitFlashSystemOptions {
  world: World;
  /** Sprite.tint (0xRRGGBB) while `elapsed < Health.flashUntil`. */
  flashTint?: number;
  /** Sprite.tint once the flash window has passed — every prefab's own default (white, i.e. no tint). */
  normalTint?: number;
}

/**
 * Drives `Sprite.tint` from `Health.flashUntil` for every `[Sprite,
 * Health]` entity — the visible half of a hit; `createMeleeAttackSystem`
 * is the only thing that ever sets `flashUntil`, this is the only thing
 * that ever reads it back out. Runs every tick regardless of whether a
 * hit just landed, since it also has to turn the tint back off once the
 * window passes — a system that only ran reactively off a hit event would
 * never un-flash.
 */
export function createHitFlashSystem(options: HitFlashSystemOptions): SystemDefinition {
  const { world, flashTint = 0xff5050, normalTint = 0xffffff } = options;
  return {
    id: "core:HitFlash",
    phase: "PostUpdate",
    query: ["Sprite", "Health"],
    run: (ctx, entities: Query) => {
      entities.forEach((entity) => {
        const health = world.get<typeof HealthSchema>(entity, "Health");
        if (!health) return;
        const flashing = ctx.elapsed < health.flashUntil;
        world.set(entity, "Sprite", { tint: flashing ? flashTint : normalTint });
      });
    },
  };
}
