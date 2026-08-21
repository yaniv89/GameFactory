import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DialogueTreeEditorDialog } from "./DialogueTreeEditorDialog";
import type { DialogueTreeNode } from "../store/projectStore";

const NOOP = () => {};

const TWO_NODE_TREE: DialogueTreeNode[] = [
  { speaker: "Elder", text: "Choose wisely.", choices: [{ id: "yes", text: "I will.", next: 1 }] },
  { speaker: "Elder", text: "Good choice." },
];

function baseProps() {
  return { open: true, onClose: NOOP, entityLabel: "Elder", nodes: [] as DialogueTreeNode[], onChange: NOOP };
}

describe("DialogueTreeEditorDialog", () => {
  it("renders nothing when closed", () => {
    render(<DialogueTreeEditorDialog {...baseProps()} open={false} />);
    expect(screen.queryByText("Dialogue — Elder")).not.toBeInTheDocument();
  });

  it("shows the empty state and adds the first line", async () => {
    const onChange = vi.fn();
    render(<DialogueTreeEditorDialog {...baseProps()} onChange={onChange} />);
    expect(screen.getByText("No lines yet")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add line" }));
    expect(onChange).toHaveBeenCalledWith([{ speaker: "", text: "" }]);
  });

  it("lists nodes in the outline with a speaker/text preview", () => {
    render(<DialogueTreeEditorDialog {...baseProps()} nodes={TWO_NODE_TREE} />);
    const outline = screen.getByRole("tree", { name: "Dialogue Outline" });
    expect(within(outline).getByText(/Elder: Choose wisely\./)).toBeInTheDocument();
    expect(within(outline).getByText(/Elder: Good choice\./)).toBeInTheDocument();
  });

  it("selects the first node by default and shows its form", () => {
    render(<DialogueTreeEditorDialog {...baseProps()} nodes={TWO_NODE_TREE} />);
    expect(screen.getByDisplayValue("Choose wisely.")).toBeInTheDocument();
  });

  it("editing speaker/text fires onChange with the updated node, preserving its choices", async () => {
    const onChange = vi.fn();
    render(<DialogueTreeEditorDialog {...baseProps()} nodes={TWO_NODE_TREE} onChange={onChange} />);
    const textInput = screen.getByDisplayValue("Choose wisely.");
    await userEvent.clear(textInput);
    await userEvent.type(textInput, "Choose carefully.{Tab}");
    expect(onChange).toHaveBeenCalledWith([
      { speaker: "Elder", text: "Choose carefully.", choices: [{ id: "yes", text: "I will.", next: 1 }] },
      TWO_NODE_TREE[1],
    ]);
  });

  it("deleting the selected line fires onChange with it removed", async () => {
    const onChange = vi.fn();
    render(<DialogueTreeEditorDialog {...baseProps()} nodes={TWO_NODE_TREE} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete line" }));
    expect(onChange).toHaveBeenCalledWith([{ speaker: "Elder", text: "Good choice." }]);
  });

  it("Move up/down are disabled at the respective boundary", () => {
    render(<DialogueTreeEditorDialog {...baseProps()} nodes={TWO_NODE_TREE} />);
    expect(screen.getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move down" })).not.toBeDisabled();
  });

  it("shows the selected node's choices, including its destination select", () => {
    render(<DialogueTreeEditorDialog {...baseProps()} nodes={TWO_NODE_TREE} />);
    expect(screen.getByDisplayValue("I will.")).toBeInTheDocument();
    expect(screen.getByLabelText("Leads to")).toHaveValue("1");
  });

  it("adding a choice fires onChange with a new terminal choice appended", async () => {
    const onChange = vi.fn();
    const oneNode: DialogueTreeNode[] = [{ speaker: "Elder", text: "Hello." }];
    render(<DialogueTreeEditorDialog {...baseProps()} nodes={oneNode} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Add choice" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [updated] = onChange.mock.calls[0] as [DialogueTreeNode[]];
    expect(updated[0]!.choices).toHaveLength(1);
    expect(updated[0]!.choices![0]).toMatchObject({ text: "", next: -1 });
  });

  it("changing a choice's destination fires onChange with the new next index", async () => {
    const onChange = vi.fn();
    render(<DialogueTreeEditorDialog {...baseProps()} nodes={TWO_NODE_TREE} onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText("Leads to"), "0");
    expect(onChange).toHaveBeenCalledWith([
      { speaker: "Elder", text: "Choose wisely.", choices: [{ id: "yes", text: "I will.", next: 0 }] },
      TWO_NODE_TREE[1],
    ]);
  });

  it("removing a choice fires onChange with the choices key dropped entirely", async () => {
    const onChange = vi.fn();
    render(<DialogueTreeEditorDialog {...baseProps()} nodes={TWO_NODE_TREE} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove choice" }));
    expect(onChange).toHaveBeenCalledWith([{ speaker: "Elder", text: "Choose wisely." }, TWO_NODE_TREE[1]]);
  });
});
