import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GraphsPanel } from "./GraphsPanel";

const NOOP = () => {};

describe("GraphsPanel", () => {
  it("shows the empty-state copy and fires onCreateGraph", async () => {
    const onCreateGraph = vi.fn();
    render(<GraphsPanel state="empty" onCreateGraph={onCreateGraph} />);
    expect(screen.getByText("No graphs yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create a graph" }));
    expect(onCreateGraph).toHaveBeenCalledOnce();
  });

  it("lists graphs with their node count when populated", () => {
    render(
      <GraphsPanel
        state="populated"
        onCreateGraph={NOOP}
        graphs={[{ id: "g1", name: "Boss fight logic", nodeCount: 12 }]}
      />,
    );
    expect(screen.getByDisplayValue("Boss fight logic")).toBeInTheDocument();
    expect(screen.getByText("12 nodes")).toBeInTheDocument();
  });

  it("singularizes the node count for exactly one node", () => {
    render(<GraphsPanel state="populated" onCreateGraph={NOOP} graphs={[{ id: "g1", name: "Empty-ish", nodeCount: 1 }]} />);
    expect(screen.getByText("1 node")).toBeInTheDocument();
  });

  it("fires onRenameGraph with the new name when the name field is blurred", async () => {
    const onRenameGraph = vi.fn();
    render(
      <GraphsPanel
        state="populated"
        onCreateGraph={NOOP}
        onRenameGraph={onRenameGraph}
        graphs={[{ id: "g1", name: "Boss fight logic", nodeCount: 0 }]}
      />,
    );
    const input = screen.getByDisplayValue("Boss fight logic");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed{Tab}");
    expect(onRenameGraph).toHaveBeenCalledWith("g1", "Renamed");
  });

  it("fires onOpenGraph and onDeleteGraph from their row buttons", async () => {
    const onOpenGraph = vi.fn();
    const onDeleteGraph = vi.fn();
    render(
      <GraphsPanel
        state="populated"
        onCreateGraph={NOOP}
        onOpenGraph={onOpenGraph}
        onDeleteGraph={onDeleteGraph}
        graphs={[{ id: "g1", name: "Boss fight logic", nodeCount: 0 }]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpenGraph).toHaveBeenCalledWith("g1");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDeleteGraph).toHaveBeenCalledWith("g1");
  });

  it("always shows a 'New graph' action, even when populated", () => {
    render(<GraphsPanel state="populated" onCreateGraph={NOOP} graphs={[{ id: "g1", name: "A", nodeCount: 0 }]} />);
    expect(screen.getByRole("button", { name: "New graph" })).toBeInTheDocument();
  });
});
