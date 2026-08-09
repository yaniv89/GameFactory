import type { EntityId, Query, World } from "@forge/core";

export interface EntitySnapshotEntry {
  readonly id: EntityId;
  readonly components: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

export interface TickSnapshot {
  readonly dt: number;
  readonly alpha: number;
  readonly elapsed: number;
  readonly frame: number;
  readonly entities: readonly EntitySnapshotEntry[];
}

/**
 * One-shot serialization of a query's matching entities' declared-component
 * fields into a JSON-safe snapshot, per docs/adr/0005: this is the only
 * per-tick read-side cost the module bridge pays, proportional to what the
 * system actually declared in `query`, not the whole world. `query` is the
 * Scheduler's own cached `Query` for this system (passed in by the caller,
 * never re-resolved here) so this never allocates a fresh `Query`/mask on
 * the hot path — only the snapshot payload itself, which is the cost ADR
 * 0005 explicitly accepts as the price of the sandbox boundary.
 */
export function serializeEntitySnapshot(
  world: World,
  query: Query,
  componentNames: readonly string[],
): EntitySnapshotEntry[] {
  const entries: EntitySnapshotEntry[] = [];
  query.forEach((entity) => {
    const components: Record<string, Record<string, number>> = {};
    for (const name of componentNames) {
      const value = world.get(entity, name);
      if (value) components[name] = value as Record<string, number>;
    }
    entries.push({ id: entity, components });
  });
  return entries;
}
