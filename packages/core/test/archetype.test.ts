import { describe, expect, it } from "vitest";
import { Archetype } from "../src/ecs/archetype";
import type { ComponentDescriptor } from "../src/ecs/component";
import { createMask, setBit } from "../src/ecs/mask";

const transformDescriptor: ComponentDescriptor = {
  name: "Transform",
  id: 0,
  schema: { x: "f64", y: "f64" },
  defaults: { x: 0, y: 0 },
};

function makeArchetype(initialCapacity?: number): Archetype {
  const mask = createMask();
  setBit(mask, transformDescriptor.id);
  return new Archetype(mask, [transformDescriptor], initialCapacity);
}

describe("Archetype", () => {
  it("initializes a new row to the component's defaults", () => {
    const archetype = makeArchetype();
    const row = archetype.addEntity(42);
    const columns = archetype.column(0);
    expect(columns.x![row]).toBe(0);
    expect(columns.y![row]).toBe(0);
    expect(archetype.entityAt(row)).toBe(42);
  });

  it("grows capacity and preserves existing data", () => {
    const archetype = makeArchetype(2);
    const rows = [10, 11, 12, 13, 14].map((entity) => {
      const row = archetype.addEntity(entity);
      archetype.column(0).x![row] = entity;
      return row;
    });
    for (let i = 0; i < rows.length; i++) {
      expect(archetype.column(0).x![rows[i]!]).toBe([10, 11, 12, 13, 14][i]);
    }
    expect(archetype.size).toBe(5);
  });

  it("removeEntity swaps the last row into the removed slot", () => {
    const archetype = makeArchetype();
    const rowA = archetype.addEntity(1);
    archetype.addEntity(2);
    const rowC = archetype.addEntity(3);
    archetype.column(0).x![rowC] = 999;

    const moved = archetype.removeEntity(rowA);

    expect(moved).toBe(3); // entity 3 (formerly last row) moved into rowA's slot
    expect(archetype.entityAt(rowA)).toBe(3);
    expect(archetype.column(0).x![rowA]).toBe(999);
    expect(archetype.size).toBe(2);
  });

  it("removeEntity on the last row returns undefined (no swap needed)", () => {
    const archetype = makeArchetype();
    archetype.addEntity(1);
    const rowB = archetype.addEntity(2);
    const moved = archetype.removeEntity(rowB);
    expect(moved).toBeUndefined();
    expect(archetype.size).toBe(1);
  });

  it("rejects an out-of-bounds row", () => {
    const archetype = makeArchetype();
    archetype.addEntity(1);
    expect(() => archetype.removeEntity(5)).toThrow();
  });
});
