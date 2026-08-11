import type { EntityId, InputState, Query, SceneManager, World } from "@forge/core";

export interface EntitySnapshotEntry {
  readonly id: EntityId;
  readonly components: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

/** JSON-safe snapshot of `InputState` for one tick — backs the guest's `InputSnapshot` (`@forge/module-api`). Ships every currently-down/pressed/released action name rather than only the ones a particular system queries: per docs/adr/0005, a guest system reads purely from its one per-tick snapshot with no further host round trips, and `isActionDown(action)` takes an arbitrary guest-chosen string the host can't predict ahead of time. */
export interface InputSnapshotData {
  readonly down: readonly string[];
  readonly pressed: readonly string[];
  readonly released: readonly string[];
  readonly pointer: { readonly x: number; readonly y: number };
}

/** JSON-safe snapshot of `SceneManager.currentSceneId` for one tick — backs the guest's `SceneApi.currentSceneId`. `transitionTo()` is a write, not part of this read-only snapshot; see `__forge_sceneTransitionTo` in moduleBridge.ts. */
export interface SceneSnapshotData {
  readonly currentSceneId: string;
}

export interface TickSnapshot {
  readonly dt: number;
  readonly alpha: number;
  readonly elapsed: number;
  readonly frame: number;
  readonly entities: readonly EntitySnapshotEntry[];
  readonly input: InputSnapshotData;
  readonly scene: SceneSnapshotData;
}

export function serializeInputSnapshot(input: InputState): InputSnapshotData {
  return {
    down: Array.from(input.downActionNames),
    pressed: Array.from(input.pressedActionNames),
    released: Array.from(input.releasedActionNames),
    pointer: { x: input.pointerPosition.x, y: input.pointerPosition.y },
  };
}

export function serializeSceneSnapshot(scene: SceneManager): SceneSnapshotData {
  return { currentSceneId: scene.currentSceneId };
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
