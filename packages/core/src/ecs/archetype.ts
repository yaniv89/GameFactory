import { FIELD_ARRAY_CTOR, type ComponentDescriptor } from "./component";
import type { EntityId } from "./entity";
import { maskKey, type ComponentMask } from "./mask";

export type TypedArrayLike = Float64Array | Float32Array | Int32Array | Uint32Array | Uint8Array;

/** field name -> the typed array backing it, one element per row. */
export type ColumnSet = Record<string, TypedArrayLike>;

/**
 * One archetype = one exact component set, backed by a contiguous chunk of
 * typed arrays per docs/SPEC.md Section 8.4. Growth reallocates (copies old
 * data into a bigger typed array) and only happens when `size` catches up
 * with `capacity` — a rare, setup-time-ish event, not a per-tick one.
 * Removal is swap-with-last: O(1), no shifting, no allocation.
 */
export class Archetype {
  readonly mask: ComponentMask;
  readonly componentIds: readonly number[];
  readonly key: string;

  private capacity: number;
  private rowCount = 0;
  private entityColumn: Int32Array;
  private readonly descriptorById = new Map<number, ComponentDescriptor>();
  private readonly columnsById = new Map<number, ColumnSet>();

  constructor(mask: ComponentMask, descriptors: readonly ComponentDescriptor[], initialCapacity = 8) {
    this.mask = mask;
    this.componentIds = descriptors.map((d) => d.id);
    this.key = maskKey(mask);
    this.capacity = Math.max(1, initialCapacity);
    this.entityColumn = new Int32Array(this.capacity);
    for (const descriptor of descriptors) {
      this.descriptorById.set(descriptor.id, descriptor);
      this.columnsById.set(descriptor.id, this.allocateColumns(descriptor, this.capacity));
    }
  }

  private allocateColumns(descriptor: ComponentDescriptor, capacity: number): ColumnSet {
    const columns: ColumnSet = {};
    for (const field of Object.keys(descriptor.schema)) {
      const fieldType = descriptor.schema[field]!;
      const Ctor = FIELD_ARRAY_CTOR[fieldType];
      columns[field] = new Ctor(capacity);
    }
    return columns;
  }

  get size(): number {
    return this.rowCount;
  }

  hasComponent(componentId: number): boolean {
    return this.columnsById.has(componentId);
  }

  /** Named field access for a component this archetype carries. Used by queries and by World.get/set. */
  column(componentId: number): ColumnSet {
    const columns = this.columnsById.get(componentId);
    if (!columns) {
      throw new Error(`Archetype: does not carry component id ${componentId}`);
    }
    return columns;
  }

  entityAt(row: number): EntityId {
    const entity = this.entityColumn[row];
    if (entity === undefined) {
      throw new Error(`Archetype.entityAt: row ${row} out of bounds (size ${this.rowCount})`);
    }
    return entity;
  }

  private grow(minCapacity: number): void {
    const newCapacity = Math.max(minCapacity, this.capacity * 2);
    const grownEntityColumn = new Int32Array(newCapacity);
    grownEntityColumn.set(this.entityColumn);
    this.entityColumn = grownEntityColumn;

    for (const [componentId, columns] of this.columnsById) {
      const descriptor = this.descriptorById.get(componentId)!;
      const grownColumns = this.allocateColumns(descriptor, newCapacity);
      for (const field of Object.keys(descriptor.schema)) {
        grownColumns[field]!.set(columns[field]!);
      }
      this.columnsById.set(componentId, grownColumns);
    }
    this.capacity = newCapacity;
  }

  /** Appends a row for `entity`, initialized to every carried component's defaults. Returns the row. */
  addEntity(entity: EntityId): number {
    if (this.rowCount >= this.capacity) {
      this.grow(this.rowCount + 1);
    }
    const row = this.rowCount++;
    this.entityColumn[row] = entity;
    for (const [componentId, columns] of this.columnsById) {
      const descriptor = this.descriptorById.get(componentId)!;
      for (const field of Object.keys(descriptor.schema)) {
        columns[field]![row] = descriptor.defaults[field]!;
      }
    }
    return row;
  }

  /**
   * Removes `row` via swap-with-last. Returns the entity that occupied the
   * last row (now moved into `row`), so the caller (World) can update that
   * entity's row index — or undefined if `row` was already last.
   */
  removeEntity(row: number): EntityId | undefined {
    const lastRow = this.rowCount - 1;
    if (row < 0 || row > lastRow) {
      throw new Error(`Archetype.removeEntity: row ${row} out of bounds (size ${this.rowCount})`);
    }
    let movedEntity: EntityId | undefined;
    if (row !== lastRow) {
      this.entityColumn[row] = this.entityColumn[lastRow]!;
      for (const [componentId, columns] of this.columnsById) {
        const descriptor = this.descriptorById.get(componentId)!;
        for (const field of Object.keys(descriptor.schema)) {
          columns[field]![row] = columns[field]![lastRow]!;
        }
      }
      movedEntity = this.entityColumn[row];
    }
    this.rowCount = lastRow;
    return movedEntity;
  }
}
