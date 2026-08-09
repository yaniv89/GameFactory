import type { EntityId } from "../ecs/entity";
import { entityIndex } from "../ecs/entity";
import type { AABB } from "./aabb";

/**
 * Uniform-grid broad phase, per CLAUDE.md Section 2.3. Rebuilt fully every
 * fixed step rather than incrementally updated — colliders can move every
 * step, and incremental remove/re-insert bookkeeping is exactly the kind
 * of optimization CLAUDE.md Section 1.5, guardrail 22 says to earn with a
 * profiled number, not assume. Cell buckets and the cell map itself are
 * still reused across steps (only their contents are cleared) so a full
 * rebuild doesn't mean full reallocation — see `clear()`.
 */
export class SpatialHash {
  private readonly cellSize: number;
  private readonly cells = new Map<string, EntityId[]>();
  private readonly occupiedKeys: string[] = [];
  private readonly pairDedup = new Set<number>();

  constructor(cellSize: number) {
    if (!(cellSize > 0)) {
      throw new Error(`SpatialHash: cellSize must be positive, got ${cellSize}`);
    }
    this.cellSize = cellSize;
  }

  /** Empties every bucket touched since the last clear(), without discarding the bucket arrays or the cell map. */
  clear(): void {
    for (const key of this.occupiedKeys) {
      this.cells.get(key)!.length = 0;
    }
    this.occupiedKeys.length = 0;
  }

  /** Inserts `entity` into every grid cell its AABB overlaps. */
  insert(entity: EntityId, aabb: AABB): void {
    const minCellX = Math.floor(aabb.minX / this.cellSize);
    const minCellY = Math.floor(aabb.minY / this.cellSize);
    const maxCellX = Math.floor(aabb.maxX / this.cellSize);
    const maxCellY = Math.floor(aabb.maxY / this.cellSize);

    for (let cy = minCellY; cy <= maxCellY; cy++) {
      for (let cx = minCellX; cx <= maxCellX; cx++) {
        const key = `${cx},${cy}`;
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        if (bucket.length === 0) this.occupiedKeys.push(key);
        bucket.push(entity);
      }
    }
  }

  /**
   * Calls `fn` once per unique pair of entities sharing at least one
   * cell — broad-phase candidates, not confirmed overlaps. A pair sharing
   * multiple cells (a large AABB spanning several) is still reported only
   * once per call, via a dedup set keyed on entity *index* (not the full
   * generation-bearing EntityId — see `pairKey`).
   */
  forEachCandidatePair(fn: (a: EntityId, b: EntityId) => void): void {
    this.pairDedup.clear();
    for (const key of this.occupiedKeys) {
      const bucket = this.cells.get(key)!;
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i]!;
          const b = bucket[j]!;
          const key2 = pairKey(a, b);
          if (this.pairDedup.has(key2)) continue;
          this.pairDedup.add(key2);
          fn(a, b);
        }
      }
    }
  }
}

/**
 * A collision-free numeric key for an unordered entity pair. Uses each
 * entity's *index* (20 bits, per `entity.ts`), not its full packed id
 * (which includes a generation counter and can render as a negative
 * signed-32-bit number) — two simultaneously-alive entities always have
 * distinct indices, so this is safe within a single broad-phase pass.
 */
export function pairKey(a: EntityId, b: EntityId): number {
  const indexA = entityIndex(a);
  const indexB = entityIndex(b);
  const lo = Math.min(indexA, indexB);
  const hi = Math.max(indexA, indexB);
  return lo * (1 << 20) + hi;
}
