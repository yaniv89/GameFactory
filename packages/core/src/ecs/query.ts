import type { Archetype } from "./archetype";
import type { EntityId } from "./entity";
import { maskContainsAll, type ComponentMask } from "./mask";

export interface QueryChunk {
  readonly archetype: Archetype;
  readonly size: number;
}

/** The subset of World a Query needs — kept narrow to avoid a circular import with world.ts. */
export interface QueryWorld {
  readonly archetypeVersion: number;
  archetypesMatching(required: ComponentMask): Archetype[];
}

/**
 * A cached view over the archetypes matching a fixed component set. The
 * matched-archetype list is recomputed only when the world's archetype
 * count changes (a new component combination appeared) — in the steady
 * state, where no new archetypes are being created mid-game, `forEach` and
 * `forEachChunk` do no allocation beyond what the caller's own callback
 * does.
 */
export class Query {
  private matched: Archetype[] = [];
  private lastArchetypeVersion = -1;

  constructor(
    private readonly required: ComponentMask,
    private readonly world: QueryWorld,
  ) {}

  private refresh(): void {
    if (this.world.archetypeVersion === this.lastArchetypeVersion) return;
    this.matched = this.world.archetypesMatching(this.required);
    this.lastArchetypeVersion = this.world.archetypeVersion;
  }

  /**
   * Chunk iteration: grab each matching archetype's typed-array columns
   * once, then loop rows yourself. This is the hot-path shape — one
   * column lookup per archetype, not per entity.
   */
  forEachChunk(fn: (chunk: QueryChunk) => void): void {
    this.refresh();
    for (const archetype of this.matched) {
      if (archetype.size === 0) continue;
      fn({ archetype, size: archetype.size });
    }
  }

  /** Per-entity convenience iteration. `entity` and `row` are primitives — no object allocated per entity. */
  forEach(fn: (entity: EntityId, archetype: Archetype, row: number) => void): void {
    this.refresh();
    for (const archetype of this.matched) {
      const size = archetype.size;
      for (let row = 0; row < size; row++) {
        fn(archetype.entityAt(row), archetype, row);
      }
    }
  }

  /** Total entities currently matching, across every matched archetype. */
  count(): number {
    this.refresh();
    let total = 0;
    for (const archetype of this.matched) total += archetype.size;
    return total;
  }
}
