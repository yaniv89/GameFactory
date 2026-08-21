import { Button, Dialog, Input, Select, Textarea } from "@forge/ds";
import { flexRender, getCoreRowModel, useReactTable, type CellContext, type ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import type { DataTableColumn } from "../store/projectStore";
import { csvToTable, tableToCsv } from "./csv";
import { addColumn, addRow, configureColumn, removeColumn, removeRow, setCell } from "./dataTableEditing";
import "./DataTableEditorDialog.css";

const COLUMN_TYPE_OPTIONS = [
  { value: "string", label: "Text" },
  { value: "number", label: "Number" },
  { value: "boolean", label: "True / False" },
];

export interface DataTableEditorDialogProps {
  open: boolean;
  onClose: () => void;
  tableName: string;
  columns: readonly DataTableColumn[];
  rows: readonly Record<string, unknown>[];
  onChange: (columns: DataTableColumn[], rows: Record<string, unknown>[]) => void;
}

/**
 * docs/adr/0018 Decision 3 (M12) — the spreadsheet-shaped editor for one
 * data table's columns and rows, plus CSV import/export. Unlike
 * `GraphEditorDialog`'s typed-socket canvas or `DialogueTreeEditorDialog`'s
 * outline-and-form split, a data table's actual content genuinely is a
 * grid — `@tanstack/react-table` (CLAUDE.md 2.2, "Tables | TanStack Table
 * v8 | Data table editor," reserved for exactly this) renders it as one,
 * over plain `<table>` markup this component owns (TanStack Table is
 * headless: it computes header/row/cell models, this component supplies
 * every DOM node via `flexRender`).
 *
 * No per-cell store commands exist in `projectStore.ts` (the same choice
 * M10 made for dialogue trees, for the identical reason): every edit here
 * — add/remove a column, rename a column, change a column's type, add/
 * remove a row, edit a cell, import a CSV — computes a whole new
 * `{columns, rows}` value (`dataTableEditing.ts`/`csv.ts`'s pure helpers)
 * and hands it to `onChange`, which the container routes to the existing
 * `configureDataTable` action (already JSON-diff no-op-suppressing).
 *
 * Every cell is a plain text `Input`, regardless of the column's declared
 * type — `setCell` coerces the raw text against that type. A real,
 * honestly-scoped v1 trim, not a silent one: a boolean column rendered as
 * a `Checkbox` per cell would need `Checkbox`'s own visible-label markup
 * reworked to fit a compact grid cell, unlike `Input`'s (whose label this
 * file visually hides via its own scoped CSS, keeping the label in the
 * accessibility tree per CLAUDE.md 5.6 without showing it above every
 * cell) — real future UX work, out of scope for M12's own bar (an author
 * *can* author a true/false column and edit it today, typing "true"/
 * "false", the same "copy-paste and all" honesty QuestsPanel's own doc
 * comment already accepted for cross-referencing ids).
 */
export function DataTableEditorDialog({ open, onClose, tableName, columns, rows, onChange }: DataTableEditorDialogProps) {
  const [csvText, setCsvText] = useState("");
  const [importError, setImportError] = useState<string | undefined>(undefined);

  const mutableColumns = columns as DataTableColumn[];
  const mutableRows = rows as Record<string, unknown>[];

  const tanstackColumns = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      mutableColumns.map((column) => ({
        id: column.id,
        header: column.name,
        accessorFn: (row) => row[column.id],
        cell: (context: CellContext<Record<string, unknown>, unknown>) => (
          <div className="fg-data-table-editor__cell">
            <Input
              label={`Row ${context.row.index + 1}, ${column.name}`}
              value={String(context.getValue() ?? "")}
              onChange={(event) => onChange(...toColumnsAndRows(setCell({ columns: mutableColumns, rows: mutableRows }, context.row.index, column.id, event.target.value)))}
            />
          </div>
        ),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mutableColumns, mutableRows],
  );

  const table = useReactTable({ data: mutableRows, columns: tanstackColumns, getCoreRowModel: getCoreRowModel() });

  const importCsv = () => {
    try {
      const imported = csvToTable(csvText, () => crypto.randomUUID());
      onChange(...toColumnsAndRows(imported));
      setImportError(undefined);
      setCsvText("");
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  const exportCsv = () => {
    const csv = tableToCsv(mutableColumns, mutableRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${tableName || "table"}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog open={open} title={`Data Table — ${tableName}`} onClose={onClose}>
      <div className="fg-data-table-editor">
        <section className="fg-data-table-editor__columns">
          <h3>Columns</h3>
          <ul className="fg-list">
            {mutableColumns.map((column) => (
              <li key={column.id} className="fg-data-table-editor__column-row">
                <Input
                  label="Column name"
                  value={column.name}
                  onChange={(event) =>
                    onChange(...toColumnsAndRows(configureColumn({ columns: mutableColumns, rows: mutableRows }, column.id, { name: event.target.value, type: column.type })))
                  }
                />
                <Select
                  label="Type"
                  options={COLUMN_TYPE_OPTIONS}
                  value={column.type}
                  onChange={(event) =>
                    onChange(
                      ...toColumnsAndRows(
                        configureColumn({ columns: mutableColumns, rows: mutableRows }, column.id, {
                          name: column.name,
                          type: event.target.value as DataTableColumn["type"],
                        }),
                      ),
                    )
                  }
                />
                <Button variant="destructive" onClick={() => onChange(...toColumnsAndRows(removeColumn({ columns: mutableColumns, rows: mutableRows }, column.id)))}>
                  Remove column
                </Button>
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={() => onChange(...toColumnsAndRows(addColumn({ columns: mutableColumns, rows: mutableRows }, crypto.randomUUID())))}>
            Add column
          </Button>
        </section>

        <section className="fg-data-table-editor__grid">
          <h3>Rows</h3>
          {mutableColumns.length === 0 ? (
            <p className="fg-list__secondary">Add a column before adding rows.</p>
          ) : (
            <div className="fg-data-table-editor__grid-scroll">
              <table className="fg-data-table-editor__table">
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</th>
                      ))}
                      <th>
                        <span className="fg-visually-hidden">Row actions</span>
                      </th>
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                      ))}
                      <td>
                        <Button variant="destructive" onClick={() => onChange(...toColumnsAndRows(removeRow({ columns: mutableColumns, rows: mutableRows }, row.index)))}>
                          Delete row
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Button
            variant="secondary"
            disabled={mutableColumns.length === 0}
            onClick={() => onChange(...toColumnsAndRows(addRow({ columns: mutableColumns, rows: mutableRows })))}
          >
            Add row
          </Button>
        </section>

        <section className="fg-data-table-editor__csv">
          <h3>Import / export CSV</h3>
          <Textarea
            label="Paste CSV to import"
            value={csvText}
            onChange={(event) => setCsvText(event.target.value)}
            {...(importError ? { error: importError } : { hint: "The first row is read as column names. Importing replaces every column and row in this table." })}
          />
          <div className="fg-data-table-editor__csv-actions">
            <Button variant="primary" disabled={csvText.trim().length === 0} onClick={importCsv}>
              Import CSV
            </Button>
            <Button variant="secondary" disabled={mutableColumns.length === 0} onClick={exportCsv}>
              Export CSV
            </Button>
          </div>
        </section>
      </div>
    </Dialog>
  );
}

function toColumnsAndRows(data: { columns: DataTableColumn[]; rows: Record<string, unknown>[] }): [DataTableColumn[], Record<string, unknown>[]] {
  return [data.columns, data.rows];
}
