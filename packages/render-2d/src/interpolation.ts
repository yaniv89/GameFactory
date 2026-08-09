import { TransformSchema, type EntityId, type Query, type SystemDefinition, type World } from "@forge/core";
import { EntityDiffTracker } from "./entityDiff";

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface TransformSnapshot {
  x: number;
  y: number;
  rotation: number;
}

/**
 * Holds, per entity, the Transform value as of the start of the most
 * recently completed fixed step — the "previous" state that PreRender
 * blends from using the accumulator's leftover `alpha` (docs/SPEC.md
 * Section 8.2's interpolated-rendering diagram). Snapshot objects are
 * reused in place rather than replaced, so steady-state entities cost no
 * allocation once first seen.
 */
export class TransformSnapshotStore {
  private readonly snapshots = new Map<EntityId, TransformSnapshot>();

  get(entity: EntityId): TransformSnapshot | undefined {
    return this.snapshots.get(entity);
  }

  /** @internal written by createTransformSnapshotSystem */
  set(entity: EntityId, x: number, y: number, rotation: number): void {
    const existing = this.snapshots.get(entity);
    if (existing) {
      existing.x = x;
      existing.y = y;
      existing.rotation = rotation;
    } else {
      this.snapshots.set(entity, { x, y, rotation });
    }
  }

  /** @internal written by createTransformSnapshotSystem when an entity drops out of the Transform query */
  delete(entity: EntityId): void {
    this.snapshots.delete(entity);
  }
}

/**
 * Must run first in `PreUpdate`, before any system integrates movement,
 * so the snapshot captures each entity's position as it was *before* this
 * fixed step — the value PreRender's interpolation blends away from.
 */
export function createTransformSnapshotSystem(world: World, store: TransformSnapshotStore): SystemDefinition {
  const tracker = new EntityDiffTracker();
  return {
    id: "@forge/render-2d:SnapshotTransform",
    phase: "PreUpdate",
    query: ["Transform"],
    skipIfEmpty: false,
    run: (_ctx, entities: Query) => {
      entities.forEach((entity) => {
        tracker.see(entity);
        const transform = world.get<typeof TransformSchema>(entity, "Transform");
        if (transform) store.set(entity, transform.x, transform.y, transform.rotation);
      });
      for (const entity of tracker.endFrame()) store.delete(entity);
    },
  };
}
