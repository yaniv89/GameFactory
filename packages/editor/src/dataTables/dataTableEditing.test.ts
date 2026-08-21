import { describe, expect, it } from "vitest";
import { addColumn, addRow, configureColumn, removeColumn, removeRow, setCell, type DataTableData } from "./dataTableEditing";

const EMPTY: DataTableData = { columns: [], rows: [] };

const ONE_STRING_COLUMN: DataTableData = {
  columns: [{ id: "name", name: "Name", type: "string" }],
  rows: [{ name: "sword" }, { name: "shield" }],
};

describe("addColumn", () => {
  it("appends a new string column and backfills every existing row with an empty cell", () => {
    const result = addColumn(ONE_STRING_COLUMN, "rarity");
    expect(result.columns).toEqual([
      { id: "name", name: "Name", type: "string" },
      { id: "rarity", name: "Column", type: "string" },
    ]);
    expect(result.rows).toEqual([
      { name: "sword", rarity: "" },
      { name: "shield", rarity: "" },
    ]);
  });

  it("works on an empty table", () => {
    const result = addColumn(EMPTY, "id");
    expect(result.columns).toEqual([{ id: "id", name: "Column", type: "string" }]);
    expect(result.rows).toEqual([]);
  });
});

describe("removeColumn", () => {
  it("drops the column and strips it out of every row", () => {
    const withTwo = addColumn(ONE_STRING_COLUMN, "rarity");
    const result = removeColumn(withTwo, "rarity");
    expect(result.columns).toEqual([{ id: "name", name: "Name", type: "string" }]);
    expect(result.rows).toEqual([{ name: "sword" }, { name: "shield" }]);
  });

  it("is a no-op on an unknown column id", () => {
    const result = removeColumn(ONE_STRING_COLUMN, "nonexistent");
    expect(result).toEqual(ONE_STRING_COLUMN);
  });
});

describe("configureColumn", () => {
  it("renames a column without touching any cell values", () => {
    const result = configureColumn(ONE_STRING_COLUMN, "name", { name: "Item Name", type: "string" });
    expect(result.columns).toEqual([{ id: "name", name: "Item Name", type: "string" }]);
    expect(result.rows).toEqual(ONE_STRING_COLUMN.rows);
  });

  it("re-coerces every existing cell when the column's type changes", () => {
    const table: DataTableData = {
      columns: [{ id: "count", name: "Count", type: "string" }],
      rows: [{ count: "5" }, { count: "not a number" }],
    };
    const result = configureColumn(table, "count", { name: "Count", type: "number" });
    expect(result.columns).toEqual([{ id: "count", name: "Count", type: "number" }]);
    expect(result.rows).toEqual([{ count: 5 }, { count: 0 }]);
  });

  it("is a no-op on an unknown column id", () => {
    const result = configureColumn(ONE_STRING_COLUMN, "nonexistent", { name: "x", type: "number" });
    expect(result).toEqual(ONE_STRING_COLUMN);
  });
});

describe("addRow", () => {
  it("appends a row with each column's default value for its type", () => {
    const table: DataTableData = {
      columns: [
        { id: "name", name: "Name", type: "string" },
        { id: "weight", name: "Weight", type: "number" },
        { id: "rare", name: "Rare", type: "boolean" },
      ],
      rows: [],
    };
    const result = addRow(table);
    expect(result.rows).toEqual([{ name: "", weight: 0, rare: false }]);
  });
});

describe("removeRow", () => {
  it("removes only the row at the given index", () => {
    const result = removeRow(ONE_STRING_COLUMN, 0);
    expect(result.rows).toEqual([{ name: "shield" }]);
  });
});

describe("setCell", () => {
  it("coerces a raw string edit to the column's number type", () => {
    const table: DataTableData = { columns: [{ id: "weight", name: "Weight", type: "number" }], rows: [{ weight: 0 }] };
    const result = setCell(table, 0, "weight", "3.5");
    expect(result.rows).toEqual([{ weight: 3.5 }]);
  });

  it("coerces a raw string edit to the column's boolean type", () => {
    const table: DataTableData = { columns: [{ id: "rare", name: "Rare", type: "boolean" }], rows: [{ rare: false }] };
    const result = setCell(table, 0, "rare", "true");
    expect(result.rows).toEqual([{ rare: true }]);
  });

  it("falls back to 0 for a non-numeric edit on a number column, rather than storing NaN or a string", () => {
    const table: DataTableData = { columns: [{ id: "weight", name: "Weight", type: "number" }], rows: [{ weight: 5 }] };
    const result = setCell(table, 0, "weight", "not a number");
    expect(result.rows).toEqual([{ weight: 0 }]);
  });

  it("leaves every other row untouched", () => {
    const result = setCell(ONE_STRING_COLUMN, 1, "name", "spear");
    expect(result.rows).toEqual([{ name: "sword" }, { name: "spear" }]);
  });
});
