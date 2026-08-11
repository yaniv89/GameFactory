import type { EventBusImpl } from "../events/eventBus";

/** Payload of the `"scene:changed"` event `SceneManager` emits once a queued transition is actually applied. */
export interface SceneChangedEvent {
  readonly from: string;
  readonly to: string;
}

/**
 * Backing implementation for `@forge/module-api`'s `SceneApi`
 * (`currentSceneId`/`transitionTo`) — the minimal scene query/transition
 * primitive `TickContext.scene` needs, for both native `@forge/core`
 * systems and sandboxed guest modules via the sandbox bridge
 * (`packages/runtime-host/src/module/`).
 *
 * `@forge/core` has no concept of what a "scene" actually *contains*
 * (tiles, entity placements — that's project-document/export-format data,
 * owned by the editor and the player app, not the engine). This class
 * only tracks *which* scene id is current and *when* a requested
 * transition takes effect; a host (the standalone player, the editor's
 * preview) is the thing that actually knows how to load/unload a scene's
 * content, and does so by subscribing to `"scene:changed"` on the same
 * `EventBusImpl` passed in here — the same "engine provides the
 * mechanism, host supplies the policy" split `WorldApi`'s deferred writes
 * and `CommandBuffer` already establish elsewhere in this codebase.
 *
 * `transitionTo()` queues a request rather than applying it immediately —
 * a system calling it mid-tick must not see `currentSceneId` change out
 * from under later systems in the *same* tick. `Scheduler` calls
 * `applyPendingTransition()` once, at the end of each fixed step, after
 * every fixed-step phase (`PreUpdate`/`Update`/`PostUpdate`/`Physics`) has
 * run — the same "settle at a defined boundary" discipline `World.flush()`
 * already uses for structural changes.
 */
export class SceneManager {
  private current: string;
  private pending: string | undefined;

  constructor(
    initialSceneId: string,
    // Accepts any caller-parameterized EventBusImpl<EventMap>: this class
    // only ever emits one fixed, known key ("scene:changed"), so it
    // deliberately doesn't force the caller's own EventMap to declare it.
    private readonly events?: EventBusImpl<any>,
  ) {
    this.current = initialSceneId;
  }

  get currentSceneId(): string {
    return this.current;
  }

  /** Queues a transition to `sceneId`, applied at the next tick boundary. A later call before that boundary overwrites the earlier request — last write wins, matching `WorldApi.set()`'s own per-tick overwrite semantics. */
  transitionTo(sceneId: string): void {
    this.pending = sceneId;
  }

  /**
   * Applies a queued transition, if any and if it actually names a
   * different scene than the current one. Returns the applied transition
   * (or `undefined` if nothing was pending, or the pending id matched the
   * current one). Emits `"scene:changed"` on the event bus passed to the
   * constructor, if one was — a `SceneManager` built without one still
   * tracks `currentSceneId` correctly, it just has nothing to notify.
   */
  applyPendingTransition(): SceneChangedEvent | undefined {
    const to = this.pending;
    this.pending = undefined;
    if (to === undefined || to === this.current) return undefined;

    const from = this.current;
    this.current = to;
    const changed: SceneChangedEvent = { from, to };
    this.events?.emit("scene:changed", changed);
    return changed;
  }
}
