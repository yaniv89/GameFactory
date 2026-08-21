import { describe, expect, it } from "vitest";
import { lookupRowNode, tableRowCountNode } from "../src/nodes/dataTables";
import { makeFakeContext } from "./support";

const LOOT_TABLE = [
  { id: "sword", weight: 5, rarity: "common" },
  { id: "shield", weight: 3, rarity: "common" },
  { id: "orb", weight: 1, rarity: "rare" },
];

describe("core:lookupRow", () => {
  it("returns the first row whose key column matches the given key", () => {
    const ctx = makeFakeContext({ dataTables: { loot: LOOT_TABLE } });
    const outputs = lookupRowNode.execute(ctx, { key: "shield" }, { table: "loot", keyColumn: "id" });
    expect(outputs).toEqual({ row: { id: "shield", weight: 3, rarity: "common" } });
  });

  it("returns null and warns when no row matches the key", () => {
    const ctx = makeFakeContext({ dataTables: { loot: LOOT_TABLE } });
    const outputs = lookupRowNode.execute(ctx, { key: "nonexistent" }, { table: "loot", keyColumn: "id" });
    expect(outputs).toEqual({ row: null });
    expect(ctx.warnings).toEqual([]);
  });

  it("returns null and warns when the table itself doesn't exist", () => {
    const ctx = makeFakeContext({ dataTables: {} });
    const outputs = lookupRowNode.execute(ctx, { key: "shield" }, { table: "loot", keyColumn: "id" });
    expect(outputs).toEqual({ row: null });
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]?.message).toContain('no data table "loot"');
  });
});

describe("core:tableRowCount", () => {
  it("returns the number of rows in the table", () => {
    const ctx = makeFakeContext({ dataTables: { loot: LOOT_TABLE } });
    const outputs = tableRowCountNode.execute(ctx, {}, { table: "loot" });
    expect(outputs).toEqual({ count: 3 });
  });

  it("returns 0 and warns when the table doesn't exist", () => {
    const ctx = makeFakeContext({ dataTables: {} });
    const outputs = tableRowCountNode.execute(ctx, {}, { table: "loot" });
    expect(outputs).toEqual({ count: 0 });
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]?.message).toContain('no data table "loot"');
  });
});
