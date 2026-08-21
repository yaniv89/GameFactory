import type { DataTableColumn } from "../store/projectStore";
import type { DataTableData } from "./dataTableEditing";

/**
 * A hand-rolled RFC 4180 CSV reader/writer (docs/adr/0018 Decision 3,
 * M12) — CLAUDE.md's dependency list (Section 2.2) names TanStack Table
 * for the grid itself but no CSV library; RFC 4180 is a small, fully
 * specified format (quoted fields, `""`-escaped embedded quotes, embedded
 * commas/newlines inside quotes, CRLF-or-LF line endings) with no
 * ambiguity worth pulling a dependency in for. Never `eval`'d, never
 * trusted as anything but plain text (CLAUDE.md 1.1.2/1.1.3) — a pasted
 * or uploaded CSV becomes table rows through this parser only, the same
 * "own the parse, don't trust the input" treatment `@forge/richtext`
 * already gives rich text.
 */

/** One field, quoted only when it actually needs to be (contains a comma, quote, or newline) — RFC 4180 §2 doesn't require quoting every field, and unnecessary quoting would make a re-exported CSV needlessly noisy to read by hand. */
function stringifyCsvField(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** Column `name`s as the header row, `rows` in column-id order — the same header/data split RFC 4180 §2 line 1 describes. CRLF line endings per the RFC's own text (§2 line 1: "each line should end with CRLF"), though `parseCsv` below accepts bare `\n` too, matching every real-world CSV producer that doesn't bother with CRLF. */
export function tableToCsv(columns: readonly DataTableColumn[], rows: readonly Record<string, unknown>[]): string {
  const header = columns.map((column) => stringifyCsvField(column.name)).join(",");
  const lines = rows.map((row) => columns.map((column) => stringifyCsvField(row[column.id])).join(","));
  return [header, ...lines].join("\r\n");
}

/**
 * A minimal RFC 4180 state machine: tracks whether the cursor is inside a
 * quoted field (where commas/newlines/lone quotes are literal, and `""`
 * is an escaped quote) or not. `\r\n` and bare `\n` both end a record
 * (real-world CSV producers disagree on which they emit); a bare `\r` not
 * followed by `\n` is treated as a literal character inside a field
 * rather than a line ending, matching the RFC's own CRLF-only definition.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  let sawAnyContent = false;

  while (i < text.length) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      sawAnyContent = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      sawAnyContent = true;
      i += 1;
      continue;
    }
    if (char === "\r" && text[i + 1] === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAnyContent = false;
      i += 2;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAnyContent = false;
      i += 1;
      continue;
    }
    field += char;
    sawAnyContent = true;
    i += 1;
  }
  // The final record has no trailing line ending — flush it, but only if
  // this call actually saw a real final field/row (an empty or
  // already-fully-consumed input shouldn't produce one spurious [""]] row).
  if (field.length > 0 || sawAnyContent || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Every non-empty cell in a column parses as a finite number — an entirely empty column defaults to `"string"` (no evidence either way, and `"string"` is the safest, most permissive default). */
function inferColumnType(values: readonly string[]): DataTableColumn["type"] {
  const nonEmpty = values.map((v) => v.trim()).filter((v) => v.length > 0);
  if (nonEmpty.length === 0) return "string";
  if (nonEmpty.every((v) => Number.isFinite(Number(v)))) return "number";
  if (nonEmpty.every((v) => v.toLowerCase() === "true" || v.toLowerCase() === "false")) return "boolean";
  return "string";
}

/**
 * The whole CSV import pipeline: parse, take row 1 as column names (fresh
 * ids via `makeColumnId`, since a CSV header is free-text a person typed
 * or exported from a spreadsheet — not a stable id, and not guaranteed
 * unique or identifier-safe), infer each column's type from its own
 * values, coerce every cell to its column's inferred type. Throws (rather
 * than silently importing garbage) on a CSV with no header row, or a data
 * row with a different field count than the header — CLAUDE.md 1.1.11
 * ("never silently swallow an error"): a malformed CSV needs a clear
 * reason, not a table quietly missing or misaligned columns.
 */
export function csvToTable(text: string, makeColumnId: () => string): DataTableData {
  const rawRows = parseCsv(text);
  if (rawRows.length === 0) throw new Error("This CSV has no header row to read column names from.");
  const [header, ...dataRows] = rawRows;
  const columnIds = header!.map(() => makeColumnId());

  for (const [index, row] of dataRows.entries()) {
    if (row.length !== header!.length) {
      throw new Error(`Row ${index + 2} has ${row.length} field(s), but the header declares ${header!.length}. Every row must have the same number of columns.`);
    }
  }

  const columnValues = columnIds.map((_, colIndex) => dataRows.map((row) => row[colIndex] ?? ""));
  const columns: DataTableColumn[] = header!.map((name, index) => ({
    id: columnIds[index]!,
    name: name.trim() || `Column ${index + 1}`,
    type: inferColumnType(columnValues[index]!),
  }));

  const rows: Record<string, unknown>[] = dataRows.map((row) => {
    const record: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      const raw = row[index] ?? "";
      record[column.id] = column.type === "number" ? Number(raw) || 0 : column.type === "boolean" ? raw.trim().toLowerCase() === "true" : raw;
    });
    return record;
  });

  return { columns, rows };
}
