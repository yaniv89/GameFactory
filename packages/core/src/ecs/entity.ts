/**
 * Entity identity: an opaque integer, per docs/SPEC.md Section 4.2 — "holds
 * no data and no behavior." Packs a recyclable index with a generation
 * counter into a single JS number (safe for 32-bit bitwise ops), so a
 * stale reference to a destroyed-and-recycled slot is detectable without
 * an allocation on every liveness check.
 */
export type EntityId = number;

const INDEX_BITS = 20; // up to 1,048,575 concurrent entities
const INDEX_MASK = (1 << INDEX_BITS) - 1;
const GENERATION_BITS = 12; // wraps after 4096 destroy/recreate cycles per slot
const GENERATION_MASK = (1 << GENERATION_BITS) - 1;

export const MAX_ENTITIES = 1 << INDEX_BITS;

export function entityIndex(id: EntityId): number {
  return id & INDEX_MASK;
}

export function entityGeneration(id: EntityId): number {
  return (id >>> INDEX_BITS) & GENERATION_MASK;
}

function packEntity(index: number, generation: number): EntityId {
  return ((generation & GENERATION_MASK) << INDEX_BITS) | (index & INDEX_MASK);
}

/**
 * Allocates and recycles entity indices. Growth (the typed array backing
 * `generations`) only happens when the live entity count exceeds current
 * capacity — not on every create/destroy — so steady-state create/destroy
 * (an entity dying and a new one spawning in its place) is allocation-free.
 */
export class EntityAllocator {
  private generations: Int32Array;
  private readonly freeList: number[] = [];
  private nextIndex = 0;
  private aliveCount = 0;

  constructor(initialCapacity = 1024) {
    this.generations = new Int32Array(Math.max(1, initialCapacity));
  }

  private ensureCapacity(index: number): void {
    if (index < this.generations.length) return;
    const grown = new Int32Array(Math.max(index + 1, this.generations.length * 2));
    grown.set(this.generations);
    this.generations = grown;
  }

  create(): EntityId {
    if (this.nextIndex >= MAX_ENTITIES && this.freeList.length === 0) {
      throw new Error(`EntityAllocator: exceeded MAX_ENTITIES (${MAX_ENTITIES})`);
    }
    let index: number;
    const recycled = this.freeList.pop();
    if (recycled !== undefined) {
      index = recycled;
    } else {
      index = this.nextIndex++;
      this.ensureCapacity(index);
    }
    this.aliveCount++;
    return packEntity(index, this.generations[index] ?? 0);
  }

  isAlive(id: EntityId): boolean {
    const index = entityIndex(id);
    if (index < 0 || index >= this.generations.length) return false;
    return this.generations[index] === entityGeneration(id);
  }

  destroy(id: EntityId): void {
    if (!this.isAlive(id)) {
      throw new Error(`EntityAllocator: entity ${id} is not alive`);
    }
    const index = entityIndex(id);
    this.generations[index] = ((this.generations[index] ?? 0) + 1) & GENERATION_MASK;
    this.freeList.push(index);
    this.aliveCount--;
  }

  get count(): number {
    return this.aliveCount;
  }

  /** Highest index ever allocated + 1. Used to size parallel lookup tables. */
  get indexBound(): number {
    return this.nextIndex;
  }

  /**
   * Re-marks a specific packed id as alive — used by save/load
   * (`packages/core/src/save/serialize.ts`) to restore entities at their
   * exact saved ids instead of allocating fresh ones, which a save file's
   * component data (namespaced by the original ids) depends on. Any
   * indices between the previous `nextIndex` and this one are pushed onto
   * the free list so they stay reachable by future `create()` calls
   * rather than being silently stranded — this is the mechanism that
   * makes restoring entities in an arbitrary order (not sorted by index)
   * safe. Throws on an index below `nextIndex` that isn't currently free,
   * which is what a save file with a duplicate entity id would produce —
   * callers validate that ahead of time (`loadSave`), so reaching this
   * throw means a genuinely corrupt save slipped through.
   */
  restore(id: EntityId): void {
    const index = entityIndex(id);
    const generation = entityGeneration(id);
    this.ensureCapacity(index);
    if (index >= this.nextIndex) {
      for (let i = this.nextIndex; i < index; i++) this.freeList.push(i);
      this.nextIndex = index + 1;
    } else {
      const pos = this.freeList.indexOf(index);
      if (pos === -1) {
        throw new Error(`EntityAllocator.restore: index ${index} is not free (duplicate entity id in save data?)`);
      }
      this.freeList.splice(pos, 1);
    }
    this.generations[index] = generation;
    this.aliveCount++;
  }
}
