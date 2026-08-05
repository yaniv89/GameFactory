import type { EntityId } from "@forge/core";

/**
 * Tracks which entities a query matched on the last call and reports which
 * ones dropped out since then (destroyed, or the queried component was
 * removed) — Query itself has no "what changed" signal, so callers that
 * need to clean up per-entity side state (a Pixi Sprite, an interpolation
 * snapshot) diff it themselves. The two Sets are swapped and reused across
 * calls; the only per-call allocation is `removedBuffer` growing to fit an
 * unusually large churn spike, which the array then keeps for next time.
 */
export class EntityDiffTracker {
  private current = new Set<EntityId>();
  private previous = new Set<EntityId>();
  private readonly removedBuffer: EntityId[] = [];

  /** Call once per currently-matching entity while iterating this frame's query. */
  see(entity: EntityId): void {
    this.current.add(entity);
  }

  /** Call once after every `see()` for this frame. Returns entities seen last frame but not this one. */
  endFrame(): readonly EntityId[] {
    this.removedBuffer.length = 0;
    for (const entity of this.previous) {
      if (!this.current.has(entity)) this.removedBuffer.push(entity);
    }
    const swap = this.previous;
    this.previous = this.current;
    this.current = swap;
    this.current.clear();
    return this.removedBuffer;
  }
}
