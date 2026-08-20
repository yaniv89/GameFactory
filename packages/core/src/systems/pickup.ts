import { ColliderSchema, PickupSchema, TransformSchema } from "../components/core";
import type { EventBus } from "../events/eventBus";
import type { EntityId } from "../ecs/entity";
import type { Query } from "../ecs/query";
import { collidersOverlap, createAABB } from "../physics/aabb";
import type { SystemDefinition } from "../scheduler/system";
import type { World } from "../ecs/world";

export interface PickupCollectedEvent {
  readonly player: EntityId;
  readonly itemId: number;
  readonly amount: number;
  /** The pickup's own position at the moment it was collected — the entity is destroyed before a listener could look it up itself, the same reason `MeleeDeathEvent` carries its own `x`/`y`. */
  readonly x: number;
  readonly y: number;
}

export type PickupEventMap = {
  "pickup:collected": PickupCollectedEvent;
};

export interface PickupSystemOptions {
  world: World;
  events: EventBus<PickupEventMap>;
}

/**
 * Finds every `[Transform, Collider, PlayerControlled]` entity (today,
 * exactly the player) and tests it against every `[Transform, Collider,
 * Pickup]` entity's own collider (`collidersOverlap` — the same narrow-phase
 * math `createMeleeAttackSystem` reuses, box-or-circle correct rather than
 * `createMeleeAttackSystem`'s box-only `aabbOverlap`, since `COIN_PICKUP_PREFAB`'s
 * own collider is a circle). On overlap, emits `"pickup:collected"` and
 * destroys the pickup outright — collected is collected, not a lingering
 * zero-amount entity waiting on some other system to notice, the same
 * "dead is dead" shape `createMeleeAttackSystem`'s own doc comment already
 * establishes for a killed target.
 */
export function createPickupSystem(options: PickupSystemOptions): SystemDefinition {
  const { world, events } = options;
  const playerAABB = createAABB();
  const pickupAABB = createAABB();
  const pickupsQuery = world.query(["Transform", "Collider", "Pickup"]);

  return {
    id: "core:Pickup",
    phase: "PostUpdate",
    query: ["Transform", "Collider", "PlayerControlled"],
    run: (_ctx, players: Query) => {
      players.forEach((player) => {
        const playerTransform = world.get<typeof TransformSchema>(player, "Transform");
        const playerCollider = world.get<typeof ColliderSchema>(player, "Collider");
        if (!playerTransform || !playerCollider) return;

        pickupsQuery.forEach((pickupEntity) => {
          const pickupTransform = world.get<typeof TransformSchema>(pickupEntity, "Transform");
          const pickupCollider = world.get<typeof ColliderSchema>(pickupEntity, "Collider");
          const pickup = world.get<typeof PickupSchema>(pickupEntity, "Pickup");
          if (!pickupTransform || !pickupCollider || !pickup) return;

          if (!collidersOverlap(playerTransform, playerCollider, pickupTransform, pickupCollider, playerAABB, pickupAABB)) return;

          events.emit("pickup:collected", {
            player,
            itemId: pickup.itemId,
            amount: pickup.amount,
            x: pickupTransform.x,
            y: pickupTransform.y,
          });
          world.destroy(pickupEntity);
        });
      });
    },
  };
}
