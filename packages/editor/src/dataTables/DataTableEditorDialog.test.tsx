import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataTableEditorDialog } from "./DataTableEditorDialog";
import type { DataTableColumn } from "../store/projectStore";

const NOOP = () => {};

const ONE_COLUMN: DataTableColumn[] = [{ id: "name", name: "Name", type: "string" }];
const TWO_ROWS = [{ name: "sword" }, { name: "shield" }];

function baseProps() {
  return { open: true, onClose: NOOP, tableName: "Loot", columns: [] as DataTableColumn[], rows: [] as Record<string, unknown>[], onChange: NOOP };
}

describe("DataTableEditorDialog", () => {
  it("renders nothing when closed", () => {
    render(<DataTableEditorDialog {...baseProps()} open={false} />);
    expect(screen.queryByText("Data Table — Loot")).not.toBeInTheDocument();
  });

  it("shows a message instead of a grid when there are no columns yet", () => {
    render(<DataTableEditorDialog {...baseProps()} />);
    expect(screen.getByText("Add a column before adding rows.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add row" })).toBeDisabled();
  });

  it("adding a column fires onChange with the new column appended and every row backfilled", async () => {
    const onChange = vi.fn();
    render(<DataTableEditorDialog {...baseProps()} columns={ONE_COLUMN} rows={TWO_ROWS} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Add column" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [columns, rows] = onChange.mock.calls[0] as [DataTableColumn[], Record<string, unknown>[]];
    expect(columns).toHaveLength(2);
    expect(rows).toEqual([
      { name: "sword", [columns[1]!.id]: "" },
      { name: "shield", [columns[1]!.id]: "" },
    ]);
  });

  it("renaming a column fires onChange without touching any cell values", async () => {
    const onChange = vi.fn();
    render(<DataTableEditorDialog {...baseProps()} columns={ONE_COLUMN} rows={TWO_ROWS} onChange={onChange} />);
    const nameInput = screen.getByDisplayValue("Name");
    await userEvent.type(nameInput, "!");
    expect(onChange).toHaveBeenLastCalledWith([{ id: "name", name: "Name!", type: "string" }], TWO_ROWS);
  });

  it("changing a column's type re-coerces every existing cell", async () => {
    const onChange = vi.fn();
    const numberLikeColumn: DataTableColumn[] = [{ id: "count", name: "Count", type: "string" }];
    render(<DataTableEditorDialog {...baseProps()} columns={numberLikeColumn} rows={[{ count: "5" }]} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText("Type"), "number");
    expect(onChange).toHaveBeenCalledWith([{ id: "count", name: "Count", type: "number" }], [{ count: 5 }]);
  });

  it("removing a column fires onChange with it dropped from every row", async () => {
    const onChange = vi.fn();
    render(<DataTableEditorDialog {...baseProps()} columns={ONE_COLUMN} rows={TWO_ROWS} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove column" }));
    expect(onChange).toHaveBeenCalledWith([], [{}, {}]);
  });

  it("adding a row fires onChange with a new row using each column's default value", async () => {
    const onChange = vi.fn();
    render(<DataTableEditorDialog {...baseProps()} columns={ONE_COLUMN} rows={TWO_ROWS} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Add row" }));
    expect(onChange).toHaveBeenCalledWith(ONE_COLUMN, [...TWO_ROWS, { name: "" }]);
  });

  it("editing a grid cell fires onChange with the coerced value at that row", async () => {
    const onChange = vi.fn();
    render(<DataTableEditorDialog {...baseProps()} columns={ONE_COLUMN} rows={TWO_ROWS} onChange={onChange} />);
    const cell = screen.getByDisplayValue("sword");
    await userEvent.type(cell, "!");
    expect(onChange).toHaveBeenLastCalledWith(ONE_COLUMN, [{ name: "sword!" }, { name: "shield" }]);
  });

  it("deleting a row fires onChange with only that row removed", async () => {
    const onChange = vi.fn();
    render(<DataTableEditorDialog {...baseProps()} columns={ONE_COLUMN} rows={TWO_ROWS} onChange={onChange} />);
    const deleteButtons = screen.getAllByRole("button", { name: "Delete row" });
    await userEvent.click(deleteButtons[0]!);
    expect(onChange).toHaveBeenCalledWith(ONE_COLUMN, [{ name: "shield" }]);
  });

  it("importing a valid pasted CSV fires onChange with the parsed columns and rows", async () => {
    const onChange = vi.fn();
    render(<DataTableEditorDialog {...baseProps()} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Paste CSV to import"), "name,weight{Enter}sword,5");
    await userEvent.click(screen.getByRole("button", { name: "Import CSV" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [columns, rows] = onChange.mock.calls[0] as [DataTableColumn[], Record<string, unknown>[]];
    expect(columns.map((c) => ({ name: c.name, type: c.type }))).toEqual([
      { name: "name", type: "string" },
      { name: "weight", type: "number" },
    ]);
    expect(rows).toEqual([{ [columns[0]!.id]: "sword", [columns[1]!.id]: 5 }]);
  });

  it("shows a clear error and never calls onChange for a malformed CSV, rather than importing garbage", async () => {
    const onChange = vi.fn();
    render(<DataTableEditorDialog {...baseProps()} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Paste CSV to import"), "a,b{Enter}1,2,3");
    await userEvent.click(screen.getByRole("button", { name: "Import CSV" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Row 2 has 3 field/)).toBeInTheDocument();
  });

  it("disables Import CSV until there is pasted text", () => {
    render(<DataTableEditorDialog {...baseProps()} />);
    expect(screen.getByRole("button", { name: "Import CSV" })).toBeDisabled();
  });

  it("disables Export CSV when there are no columns", () => {
    render(<DataTableEditorDialog {...baseProps()} />);
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
  });
});
