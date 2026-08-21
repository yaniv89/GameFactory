import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DataTablesPanel } from "./DataTablesPanel";

const NOOP = () => {};

describe("DataTablesPanel", () => {
  it("shows the empty-state copy and fires onCreateTable", async () => {
    const onCreateTable = vi.fn();
    render(<DataTablesPanel state="empty" onCreateTable={onCreateTable} />);
    expect(screen.getByText("No data tables yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create a data table" }));
    expect(onCreateTable).toHaveBeenCalledOnce();
  });

  it("lists tables with their column/row counts when populated", () => {
    render(
      <DataTablesPanel
        state="populated"
        onCreateTable={NOOP}
        tables={[{ id: "t1", name: "Loot", columnCount: 3, rowCount: 12 }]}
      />,
    );
    expect(screen.getByDisplayValue("Loot")).toBeInTheDocument();
    expect(screen.getByText("3 columns, 12 rows")).toBeInTheDocument();
  });

  it("singularizes the column/row counts for exactly one each", () => {
    render(<DataTablesPanel state="populated" onCreateTable={NOOP} tables={[{ id: "t1", name: "X", columnCount: 1, rowCount: 1 }]} />);
    expect(screen.getByText("1 column, 1 row")).toBeInTheDocument();
  });

  it("fires onRenameTable with the new name when the name field is blurred", async () => {
    const onRenameTable = vi.fn();
    render(
      <DataTablesPanel
        state="populated"
        onCreateTable={NOOP}
        onRenameTable={onRenameTable}
        tables={[{ id: "t1", name: "Loot", columnCount: 0, rowCount: 0 }]}
      />,
    );
    const input = screen.getByDisplayValue("Loot");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed{Tab}");
    expect(onRenameTable).toHaveBeenCalledWith("t1", "Renamed");
  });

  it("fires onOpenTable and onDeleteTable from their row buttons", async () => {
    const onOpenTable = vi.fn();
    const onDeleteTable = vi.fn();
    render(
      <DataTablesPanel
        state="populated"
        onCreateTable={NOOP}
        onOpenTable={onOpenTable}
        onDeleteTable={onDeleteTable}
        tables={[{ id: "t1", name: "Loot", columnCount: 0, rowCount: 0 }]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpenTable).toHaveBeenCalledWith("t1");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDeleteTable).toHaveBeenCalledWith("t1");
  });

  it("always shows a 'New data table' action, even when populated", () => {
    render(<DataTablesPanel state="populated" onCreateTable={NOOP} tables={[{ id: "t1", name: "A", columnCount: 0, rowCount: 0 }]} />);
    expect(screen.getByRole("button", { name: "New data table" })).toBeInTheDocument();
  });
});
