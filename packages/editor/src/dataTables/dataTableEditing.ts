import type { DataTableColumn } from "../store/projectStore";

/**
 * Pure edit operations over a data table's `{columns, rows}` (docs/adr/0018
 * Decision 3, M12), separated from `DataTableEditorDialog.tsx` the same way
 * `dialogueTreeEditing.ts` is separated from `DialogueTreeEditorDialog.tsx`
 * — independently unit-testable, no React/TanStack Table involved.
 *
 * `DataTableEditorDialog` has no per-column/per-row CRUD commands of its
 * own in `projectStore.ts` (the same "no dedicated store commands" choice
 * M10 made for dialogue trees, for the identical reason): every edit here
 * computes a brand-new whole `{columns, rows}` value and hands it to the
 * existing `configureDataTable` action, which already does its own
 * JSON-diff no-op suppression.
 */
export interface DataTableData {
  readonly columns: DataTableColumn[];
  readonly rows: Record<string, unknown>[];
}

/** A cell's stored value always matches its column's declared type — coercing here (not at render time) means every reader of `rows` (a graph's `core:lookupRow`, a CSV export) sees a real number/boolean, never a string masquerading as one. */
function coerceCell(raw: string, type: DataTableColumn["type"]): unknown {
  if (type === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (type === "boolean") return raw.trim().toLowerCase() === "true" || raw.trim() === "1";
  return raw;
}

function defaultCellValue(type: DataTableColumn["type"]): unknown {
  if (type === "number") return 0;
  if (type === "boolean") return false;
  return "";
}

export function addColumn(data: DataTableData, columnId: string): DataTableData {
  const column: DataTableColumn = { id: columnId, name: "Column", type: "string" };
  return {
    columns: [...data.columns, column],
    rows: data.rows.map((row) => ({ ...row, [columnId]: "" })),
  };
}

/** Drops the column from every row too — an orphaned cell under a column id nothing declares any more would be dead, invisible data (never shown, never exported), not a real "hidden" state worth keeping. */
export function removeColumn(data: DataTableData, columnId: string): DataTableData {
  return {
    columns: data.columns.filter((column) => column.id !== columnId),
    rows: data.rows.map((row) => {
      const { [columnId]: _dropped, ...rest } = row;
      return rest;
    }),
  };
}

/** Renaming never touches cell values (a column's `name` is display/CSV-header metadata only, `core:lookupRow` never reads it). Changing `type` re-coerces every existing cell under this column so stored data always matches its column's current declared type, never silently drifting out of sync with it. */
export function configureColumn(data: DataTableData, columnId: string, patch: { name: string; type: DataTableColumn["type"] }): DataTableData {
  const previous = data.columns.find((column) => column.id === columnId);
  const columns = data.columns.map((column) => (column.id === columnId ? { ...column, ...patch } : column));
  if (!previous || previous.type === patch.type) return { columns, rows: data.rows };
  const rows = data.rows.map((row) => ({ ...row, [columnId]: coerceCell(String(row[columnId] ?? ""), patch.type) }));
  return { columns, rows };
}

export function addRow(data: DataTableData): DataTableData {
  const row: Record<string, unknown> = {};
  for (const column of data.columns) row[column.id] = defaultCellValue(column.type);
  return { columns: data.columns, rows: [...data.rows, row] };
}

export function removeRow(data: DataTableData, rowIndex: number): DataTableData {
  return { columns: data.columns, rows: data.rows.filter((_, index) => index !== rowIndex) };
}

/** `rawValue` is always the raw text a cell editor produced — coerced here against the column's declared type, the same boundary `configureColumn`'s type-change path already coerces at. */
export function setCell(data: DataTableData, rowIndex: number, columnId: string, rawValue: string): DataTableData {
  const column = data.columns.find((candidate) => candidate.id === columnId);
  const value = column ? coerceCell(rawValue, column.type) : rawValue;
  return {
    columns: data.columns,
    rows: data.rows.map((row, index) => (index === rowIndex ? { ...row, [columnId]: value } : row)),
  };
}
