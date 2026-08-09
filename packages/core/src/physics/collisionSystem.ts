import { ColliderSchema, TransformSchema } from "../components/core";
import type { EntityId } from "../ecs/entity";
import type { Query } from "../ecs/query";
import type { SystemDefinition } from "../scheduler/system";
import type { World } from "../ecs/world";
import type { EventBus } from "../events/eventBus";
import { collidersOverlap, computeColliderAABB, createAABB } from "./aabb";
import { pairKey, SpatialHash } from "./spatialHash";

export interface CollisionPairEvent {
  readonly a: EntityId;
  readonly b: EntityId;
  readonly aIsTrigger: boolean;
  readonly bIsTrigger: boolean;
  readonly aLayer: number;
  readonly bLayer: number;
}

/**
 * Fired once when a pair starts/stops overlapping — not every step the
 * pair happens to still be touching. `layer` is exposed on the event but
 * not used to filter which pairs get checked: the schema (Collider.layer)
 * has no companion collision-mask field, so this system reports every
 * geometric overlap and leaves layer-based filtering to whatever consumes
 * the event, rather than inventing a layer-matrix mechanic the spec
 * doesn't define.
 */
export type CollisionEventMap = {
  "collision:enter": CollisionPairEvent;
  "collision:exit": CollisionPairEvent;
};

export interface CollisionSystemOptions {
  world: World;
  events: EventBus<CollisionEventMap>;
  /** Grid cell size for the broad-phase spatial hash. Pick roughly the size of a typical collider — see `SpatialHash`. */
  cellSize: number;
}

/**
 * Detection only — per CLAUDE.md Section 2.3, no physics-engine-style
 * resolution (push-apart, impulse response) is implemented here. That's a
 * deliberately separate concern layered on top of `collision:enter`/
 * `collision:exit` later, not something this system does implicitly.
 */
export function createCollisionSystem(options: CollisionSystemOptions): SystemDefinition {
  const { world, events, cellSize } = options;
  const hash = new SpatialHash(cellSize);

  const scratchAABB = createAABB();
  const scratchA = createAABB();
  const scratchB = createAABB();

  let overlapping = new Set<number>();
  let nextOverlapping = new Set<number>();
  const pairInfoByKey = new Map<number, CollisionPairEvent>();

  return {
    id: "core:CollisionDetection",
    phase: "Physics",
    query: ["Transform", "Collider"],
    skipIfEmpty: false,
    run: (_ctx, entities: Query) => {
      hash.clear();
      nextOverlapping.clear();

      entities.forEach((entity) => {
        const transform = world.get<typeof TransformSchema>(entity, "Transform");
        const collider = world.get<typeof ColliderSchema>(entity, "Collider");
        if (!transform || !collider) return;
        hash.insert(entity, computeColliderAABB(transform, collider, scratchAABB));
      });

      hash.forEachCandidatePair((a, b) => {
        const transformA = world.get<typeof TransformSchema>(a, "Transform");
        const colliderA = world.get<typeof ColliderSchema>(a, "Collider");
        const transformB = world.get<typeof TransformSchema>(b, "Transform");
        const colliderB = world.get<typeof ColliderSchema>(b, "Collider");
        if (!transformA || !colliderA || !transformB || !colliderB) return;

        if (!collidersOverlap(transformA, colliderA, transformB, colliderB, scratchA, scratchB)) return;

        const key = pairKey(a, b);
        nextOverlapping.add(key);
        if (!overlapping.has(key)) {
          const event: CollisionPairEvent = {
            a,
            b,
            aIsTrigger: colliderA.isTrigger !== 0,
            bIsTrigger: colliderB.isTrigger !== 0,
            aLayer: colliderA.layer,
            bLayer: colliderB.layer,
          };
          pairInfoByKey.set(key, event);
          events.emit("collision:enter", event);
        }
      });

      for (const key of overlapping) {
        if (!nextOverlapping.has(key)) {
          const event = pairInfoByKey.get(key);
          if (event) {
            events.emit("collision:exit", event);
            pairInfoByKey.delete(key);
          }
        }
      }

      const swap = overlapping;
      overlapping = nextOverlapping;
      nextOverlapping = swap;
    },
  };
}
