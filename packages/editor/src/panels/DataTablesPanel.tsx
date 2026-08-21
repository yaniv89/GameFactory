import { Button, Panel, type ViewState } from "@forge/ds";
import { JsonSchemaForm } from "../inspector/JsonSchemaForm";
import type { ObjectSchema } from "../inspector/jsonSchema";

/** Mirrors `GraphsPanel.GRAPH_NAME_SCHEMA` exactly — a table's name gets the same commit-on-blur treatment (CLAUDE.md 5.3) every other named document entity already gets. */
const TABLE_NAME_SCHEMA: ObjectSchema = {
  type: "object",
  properties: { name: { type: "string", title: "Name", minLength: 1, maxLength: 60 } },
  required: ["name"],
};

export interface DataTableSummary {
  readonly id: string;
  readonly name: string;
  readonly columnCount: number;
  readonly rowCount: number;
}

export interface DataTablesPanelProps {
  state: ViewState;
  tables?: readonly DataTableSummary[];
  onCreateTable: () => void;
  onRenameTable?: (tableId: string, name: string) => void;
  onOpenTable?: (tableId: string) => void;
  onDeleteTable?: (tableId: string) => void;
  onRetry?: () => void;
}

/**
 * docs/adr/0018 Decision 3 (J1's data tables, M12): a flat CRUD catalog,
 * the identical "which X exist" shape `GraphsPanel` already establishes
 * (rename inline, "Open" hands off to a dedicated editor Dialog for the
 * table's actual contents, "Delete" is destructive-but-undoable through
 * the same command log as everything else) — not a bespoke layout,
 * since "which data tables does this project have" is exactly the same
 * kind of question "which graphs does this project have" already is.
 */
export function DataTablesPanel({ state, tables = [], onCreateTable, onRenameTable, onOpenTable, onDeleteTable, onRetry }: DataTablesPanelProps) {
  return (
    <Panel
      title="Data Tables"
      state={state}
      empty={{
        title: "No data tables yet",
        description: "A data table is a small lookup table — drop rates, shop stock, stat curves — a graph reads by row.",
        actionLabel: "Create a data table",
        onAction: onCreateTable,
      }}
      error={{
        title: "Couldn't load data tables",
        description: "The request timed out. Your connection may be slow or the project may be very large.",
        onRetry: onRetry ?? (() => {}),
      }}
      permissionDenied={{
        title: "You have view access to this project",
        description: "Ask the project owner for editor access to create or edit data tables.",
      }}
      offline={{
        title: "Offline — changes stored locally",
        description: "Data tables will sync automatically when you reconnect.",
      }}
    >
      <ul className="fg-list">
        {tables.map((table) => (
          <li key={table.id} className="fg-graphs-list__row">
            <div className="fg-graphs-list__name">
              <JsonSchemaForm
                schema={TABLE_NAME_SCHEMA}
                values={{ name: table.name }}
                onSubmit={(values) => onRenameTable?.(table.id, values.name as string)}
              />
              <span className="fg-list__secondary">
                {table.columnCount} column{table.columnCount === 1 ? "" : "s"}, {table.rowCount} row{table.rowCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="fg-graphs-list__actions">
              <Button variant="primary" onClick={() => onOpenTable?.(table.id)}>
                Open
              </Button>
              <Button variant="destructive" onClick={() => onDeleteTable?.(table.id)}>
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <Button variant="secondary" onClick={onCreateTable}>
        New data table
      </Button>
    </Panel>
  );
}
