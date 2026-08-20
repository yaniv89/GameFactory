import { AnimatorSchema, ColliderSchema, HealthSchema, TransformSchema } from "../components/core";
import type { EventBus } from "../events/eventBus";
import type { EntityId } from "../ecs/entity";
import type { Query } from "../ecs/query";
import { aabbOverlap, computeColliderAABB, createAABB } from "../physics/aabb";
import type { SystemDefinition } from "../scheduler/system";
import type { World } from "../ecs/world";
import { facingToOffset } from "./characterAnimation";

export interface MeleeHitEvent {
  readonly attacker: EntityId;
  readonly target: EntityId;
  readonly damage: number;
  readonly targetHealthRemaining: number;
}

export interface MeleeDeathEvent {
  readonly target: EntityId;
  /** The target's own position at the moment it died — captured here since the entity is destroyed before a listener could look it up itself. */
  readonly x: number;
  readonly y: number;
}

export type MeleeAttackEventMap = {
  "combat:hit": MeleeHitEvent;
  "combat:death": MeleeDeathEvent;
};

export interface MeleeAttackSystemOptions {
  world: World;
  events: EventBus<MeleeAttackEventMap>;
  /** True exactly once per attack input, edge-detected by the caller (the same "own the input state" split `createPlayerMovementSystem`'s `keysHeld` param already establishes) — must return false again until the next press, or one held key would hit every tick. */
  consumeAttackRequest: () => boolean;
  /** World-units distance from the attacker's own position to the hitbox's center. */
  reach: number;
  /** The (square) hitbox's side length, world units. */
  size: number;
  damage: number;
  /** Speed (world units/sec) knockback sets the target's Velocity to, directed away from the attacker. */
  knockbackSpeed: number;
  invulnerabilitySec: number;
  flashSec: number;
}

/**
 * One instantaneous swing per `consumeAttackRequest()` edge: finds every
 * `[Transform, Animator, PlayerControlled]` entity (today, exactly the
 * player), places a square hitbox `reach` world units in front of it
 * along `Animator.facing`, and tests every `[Transform, Collider, Health]`
 * entity's own collider AABB against it — the same narrow-phase math
 * `createCollisionSystem` uses (`computeColliderAABB`/`aabbOverlap`),
 * reused directly rather than reimplemented. A target still inside its own
 * `Health.invulnerableUntil` window is skipped, so one swing can't
 * double-hit something its hitbox happens to still overlap. A hit that
 * drops a target's health to 0 emits `"combat:death"` (H1d's death-particle
 * burst) in addition to `"combat:hit"` (H1d's damage number, which should
 * still show the killing blow's own damage) and destroys the target
 * outright — dead is dead, not a lingering zero-health entity waiting on
 * some other system to notice.
 *
 * No persisting hitbox entity, no multi-frame duration: a swing is one
 * check on the tick it's requested, not a hazard zone that lingers. A
 * weapon needing a sustained or traveling hitbox (a spear thrust, a
 * projectile) is new, different logic layered on top of this later, not
 * a generalization of it.
 */
export function createMeleeAttackSystem(options: MeleeAttackSystemOptions): SystemDefinition {
  const { world, events, consumeAttackRequest, reach, size, damage, knockbackSpeed, invulnerabilitySec, flashSec } = options;
  const halfSize = size / 2;
  const hitboxAABB = createAABB();
  const targetAABB = createAABB();
  const targetsQuery = world.query(["Transform", "Collider", "Health"]);

  return {
    id: "core:MeleeAttack",
    phase: "Update",
    query: ["Transform", "Animator", "PlayerControlled"],
    run: (ctx, attackers: Query) => {
      if (!consumeAttackRequest()) return;

      attackers.forEach((attacker) => {
        const transform = world.get<typeof TransformSchema>(attacker, "Transform");
        const animator = world.get<typeof AnimatorSchema>(attacker, "Animator");
        if (!transform || !animator) return;

        const direction = facingToOffset(animator.facing);
        const centerX = transform.x + direction.x * reach;
        const centerY = transform.y + direction.y * reach;
        hitboxAABB.minX = centerX - halfSize;
        hitboxAABB.minY = centerY - halfSize;
        hitboxAABB.maxX = centerX + halfSize;
        hitboxAABB.maxY = centerY + halfSize;

        targetsQuery.forEach((target) => {
          if (target === attacker) return;
          const targetTransform = world.get<typeof TransformSchema>(target, "Transform");
          const targetCollider = world.get<typeof ColliderSchema>(target, "Collider");
          const health = world.get<typeof HealthSchema>(target, "Health");
          if (!targetTransform || !targetCollider || !health) return;
          if (ctx.elapsed < health.invulnerableUntil) return;

          computeColliderAABB(targetTransform, targetCollider, targetAABB);
          if (!aabbOverlap(hitboxAABB, targetAABB)) return;

          const remainingHealth = Math.max(0, health.current - damage);
          world.set(target, "Health", {
            current: remainingHealth,
            invulnerableUntil: ctx.elapsed + invulnerabilitySec,
            flashUntil: ctx.elapsed + flashSec,
          });
          events.emit("combat:hit", { attacker, target, damage, targetHealthRemaining: remainingHealth });

          if (remainingHealth <= 0) {
            // Dead: no point knocking back or flashing an entity about to
            // be destroyed — createHitFlashSystem/createKnockbackPhysicsSystem
            // would never get another tick to act on it anyway.
            events.emit("combat:death", { target, x: targetTransform.x, y: targetTransform.y });
            world.destroy(target);
            return;
          }

          if (world.has(target, "Velocity")) {
            const dx = targetTransform.x - transform.x;
            const dy = targetTransform.y - transform.y;
            const distance = Math.hypot(dx, dy) || 1;
            world.set(target, "Velocity", { vx: (dx / distance) * knockbackSpeed, vy: (dy / distance) * knockbackSpeed });
          }
        });
      });
    },
  };
}
