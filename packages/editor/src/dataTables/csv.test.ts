import { describe, expect, it } from "vitest";
import { csvToTable, parseCsv, tableToCsv } from "./csv";
import type { DataTableColumn } from "../store/projectStore";

describe("parseCsv", () => {
  it("parses a simple unquoted CSV", () => {
    expect(parseCsv("a,b,c\r\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("accepts bare LF line endings, not just CRLF", () => {
    expect(parseCsv("a,b\n1,2\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("handles a quoted field containing a comma", () => {
    expect(parseCsv('name,note\r\nsword,"sharp, shiny"')).toEqual([
      ["name", "note"],
      ["sword", "sharp, shiny"],
    ]);
  });

  it("handles a quoted field containing an embedded newline", () => {
    expect(parseCsv('name,note\r\nsword,"line one\nline two"')).toEqual([
      ["name", "note"],
      ["sword", "line one\nline two"],
    ]);
  });

  it("handles an escaped double-quote inside a quoted field", () => {
    expect(parseCsv('name\r\n"a ""legendary"" sword"')).toEqual([["name"], ['a "legendary" sword']]);
  });

  it("returns an empty array for empty input", () => {
    expect(parseCsv("")).toEqual([]);
  });

  it("handles a trailing newline without producing a spurious empty row", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("tableToCsv", () => {
  it("round-trips a simple table through parseCsv", () => {
    const columns: DataTableColumn[] = [
      { id: "id", name: "ID", type: "string" },
      { id: "weight", name: "Weight", type: "number" },
    ];
    const rows = [{ id: "sword", weight: 5 }, { id: "shield", weight: 3 }];
    const csv = tableToCsv(columns, rows);
    expect(parseCsv(csv)).toEqual([
      ["ID", "Weight"],
      ["sword", "5"],
      ["shield", "3"],
    ]);
  });

  it("quotes a field containing a comma", () => {
    const columns: DataTableColumn[] = [{ id: "note", name: "Note", type: "string" }];
    const csv = tableToCsv(columns, [{ note: "sharp, shiny" }]);
    expect(csv).toBe('Note\r\n"sharp, shiny"');
  });

  it("renders a missing cell as an empty field", () => {
    const columns: DataTableColumn[] = [{ id: "note", name: "Note", type: "string" }];
    expect(tableToCsv(columns, [{}])).toBe("Note\r\n");
  });
});

describe("csvToTable", () => {
  let nextId = 0;
  const makeColumnId = () => `col-${nextId++}`;

  it("infers a number column from all-numeric values", () => {
    const result = csvToTable("weight\r\n5\r\n3.5", makeColumnId);
    expect(result.columns[0]?.type).toBe("number");
    expect(result.rows).toEqual([{ [result.columns[0]!.id]: 5 }, { [result.columns[0]!.id]: 3.5 }]);
  });

  it("infers a boolean column from all true/false values", () => {
    const result = csvToTable("rare\r\ntrue\r\nfalse", makeColumnId);
    expect(result.columns[0]?.type).toBe("boolean");
    expect(result.rows).toEqual([{ [result.columns[0]!.id]: true }, { [result.columns[0]!.id]: false }]);
  });

  it("falls back to string when values are mixed", () => {
    const result = csvToTable("name\r\nsword\r\n5", makeColumnId);
    expect(result.columns[0]?.type).toBe("string");
    expect(result.rows).toEqual([{ [result.columns[0]!.id]: "sword" }, { [result.columns[0]!.id]: "5" }]);
  });

  it("defaults an entirely empty column to string", () => {
    const result = csvToTable("note\r\n\r\n", makeColumnId);
    expect(result.columns[0]?.type).toBe("string");
  });

  it("assigns each column a fresh id, independent of its header text", () => {
    const result = csvToTable("id,weight\r\nsword,5", makeColumnId);
    expect(result.columns.map((c) => c.name)).toEqual(["id", "weight"]);
    expect(new Set(result.columns.map((c) => c.id)).size).toBe(2);
  });

  it("throws a clear error for a header-only CSV with an inconsistent row width", () => {
    expect(() => csvToTable("a,b\r\n1,2,3", makeColumnId)).toThrow(/Row 2 has 3 field/);
  });

  it("throws a clear error for completely empty input", () => {
    expect(() => csvToTable("", makeColumnId)).toThrow(/no header row/);
  });

  it("round-trips through tableToCsv for a multi-column, multi-row table", () => {
    const original = csvToTable("name,weight,rare\r\nsword,5,true\r\nshield,3,false", makeColumnId);
    const csv = tableToCsv(original.columns, original.rows);
    const reimported = csvToTable(csv, makeColumnId);
    expect(reimported.columns.map((c) => ({ name: c.name, type: c.type }))).toEqual(
      original.columns.map((c) => ({ name: c.name, type: c.type })),
    );
  });
});
