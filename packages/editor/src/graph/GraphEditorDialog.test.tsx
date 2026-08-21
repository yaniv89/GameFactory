import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GraphEditorDialog, type GraphEditorDialogEdge, type GraphEditorDialogNode } from "./GraphEditorDialog";

const NOOP = () => {};

function baseProps() {
  return {
    open: true,
    onClose: NOOP,
    graphName: "Boss fight logic",
    nodes: [] as GraphEditorDialogNode[],
    edges: [] as GraphEditorDialogEdge[],
    onRenameGraph: NOOP,
    onAddNode: NOOP,
    onMoveNode: NOOP,
    onConfigureNode: NOOP,
    onRemoveNode: NOOP,
    onAddEdge: NOOP,
    onRemoveEdge: NOOP,
  };
}

describe("GraphEditorDialog", () => {
  it("renders nothing when closed", () => {
    render(<GraphEditorDialog {...baseProps()} open={false} />);
    expect(screen.queryByText("Graph — Boss fight logic")).not.toBeInTheDocument();
  });

  it("shows the palette grouped by category, including the core node types", () => {
    render(<GraphEditorDialog {...baseProps()} />);
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Branch" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Entity" })).toBeInTheDocument();
  });

  it("clicking a palette button adds a node with the right type and a real default config", async () => {
    const onAddNode = vi.fn();
    render(<GraphEditorDialog {...baseProps()} onAddNode={onAddNode} />);
    await userEvent.click(screen.getByRole("button", { name: "Repeat" }));
    expect(onAddNode).toHaveBeenCalledWith("core:repeat", expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }), {
      ceiling: 1000,
    });
  });

  it("lists placed nodes in the Graph Outline by their editor label", () => {
    const nodes: GraphEditorDialogNode[] = [{ id: "n1", type: "core:add", position: { x: 0, y: 0 }, config: {} }];
    render(<GraphEditorDialog {...baseProps()} nodes={nodes} />);
    const outline = screen.getByRole("tree", { name: "Graph Outline" });
    expect(within(outline).getByText("Add")).toBeInTheDocument();
  });

  it("selecting a node from the outline shows its config form and a delete button", async () => {
    const nodes: GraphEditorDialogNode[] = [
      { id: "n1", type: "core:getComponent", position: { x: 0, y: 0 }, config: { component: "health" } },
    ];
    render(<GraphEditorDialog {...baseProps()} nodes={nodes} />);
    const outline = screen.getByRole("tree", { name: "Graph Outline" });
    await userEvent.click(within(outline).getByText("Get Component"));

    expect(screen.getByDisplayValue("health")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete node" })).toBeInTheDocument();
  });

  it("editing the selected node's config form commits via onConfigureNode on blur", async () => {
    const onConfigureNode = vi.fn();
    const nodes: GraphEditorDialogNode[] = [
      { id: "n1", type: "core:getComponent", position: { x: 0, y: 0 }, config: { component: "health" } },
    ];
    render(<GraphEditorDialog {...baseProps()} nodes={nodes} onConfigureNode={onConfigureNode} />);
    await userEvent.click(within(screen.getByRole("tree", { name: "Graph Outline" })).getByText("Get Component"));

    const input = screen.getByDisplayValue("health");
    await userEvent.clear(input);
    await userEvent.type(input, "mana{Tab}");
    expect(onConfigureNode).toHaveBeenCalledWith("n1", { component: "mana" });
  });

  it("clicking Delete node fires onRemoveNode with the selected node's id", async () => {
    const onRemoveNode = vi.fn();
    const nodes: GraphEditorDialogNode[] = [{ id: "n1", type: "core:add", position: { x: 0, y: 0 }, config: {} }];
    render(<GraphEditorDialog {...baseProps()} nodes={nodes} onRemoveNode={onRemoveNode} />);
    await userEvent.click(within(screen.getByRole("tree", { name: "Graph Outline" })).getByText("Add"));
    await userEvent.click(screen.getByRole("button", { name: "Delete node" }));
    expect(onRemoveNode).toHaveBeenCalledWith("n1");
  });

  it("renaming the graph via the header form commits via onRenameGraph on blur", async () => {
    const onRenameGraph = vi.fn();
    render(<GraphEditorDialog {...baseProps()} onRenameGraph={onRenameGraph} />);
    const input = screen.getByDisplayValue("Boss fight logic");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed{Tab}");
    expect(onRenameGraph).toHaveBeenCalledWith("Renamed");
  });

  it("the keyboard connect-picker only offers valid targets, and picking one calls onAddEdge", async () => {
    const onAddEdge = vi.fn();
    const nodes: GraphEditorDialogNode[] = [
      { id: "n1", type: "core:add", position: { x: 0, y: 0 }, config: {} },
      { id: "n2", type: "core:add", position: { x: 200, y: 0 }, config: {} },
      { id: "n3", type: "core:branch", position: { x: 400, y: 0 }, config: {} },
    ];
    render(<GraphEditorDialog {...baseProps()} nodes={nodes} onAddEdge={onAddEdge} />);
    const outline = screen.getByRole("tree", { name: "Graph Outline" });
    // n1 and n2 are both "core:add", so both list as "Add" — n1 is first.
    await userEvent.click(within(outline).getAllByText("Add")[0]!);

    // n1's only output is "result" (number).
    await userEvent.click(screen.getByRole("button", { name: /Output: result/ }));

    // n2's "a"/"b" inputs are number — valid targets. n3's "condition" input
    // is boolean — an invalid target, so its button must be disabled.
    const validTarget = screen.getByRole("button", { name: /Add\.a/ });
    const invalidTarget = screen.getByRole("button", { name: /Branch\.condition/ });
    expect(validTarget).toBeEnabled();
    expect(invalidTarget).toBeDisabled();

    await userEvent.click(validTarget);
    expect(onAddEdge).toHaveBeenCalledWith({ source: "n1", sourceHandle: "result", target: "n2", targetHandle: "a" });
  });
});
