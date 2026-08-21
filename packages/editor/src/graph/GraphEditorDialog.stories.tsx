import type { Meta, StoryObj } from "@storybook/react";
import { GraphEditorDialog } from "./GraphEditorDialog";

const meta: Meta<typeof GraphEditorDialog> = {
  title: "Editor/GraphEditorDialog",
  component: GraphEditorDialog,
};
export default meta;

type Story = StoryObj<typeof GraphEditorDialog>;

const NOOP = () => {};
const BASE_ARGS = {
  open: true,
  onClose: NOOP,
  onRenameGraph: NOOP,
  onAddNode: NOOP,
  onMoveNode: NOOP,
  onConfigureNode: NOOP,
  onRemoveNode: NOOP,
  onAddEdge: NOOP,
  onRemoveEdge: NOOP,
};

export const EmptyGraph: Story = {
  args: { ...BASE_ARGS, graphName: "New graph", nodes: [], edges: [] },
};

export const AShortDecisionChain: Story = {
  name: "A short decision chain",
  args: {
    ...BASE_ARGS,
    graphName: "Boss fight logic",
    nodes: [
      { id: "n1", type: "core:onEvent", position: { x: 40, y: 40 }, config: { event: "combat:tick" } },
      { id: "n2", type: "core:getComponent", position: { x: 260, y: 40 }, config: { component: "health" } },
      { id: "n3", type: "core:lessThan", position: { x: 480, y: 40 }, config: {} },
      { id: "n4", type: "core:branch", position: { x: 700, y: 40 }, config: {} },
      { id: "n5", type: "core:emitEvent", position: { x: 920, y: 40 }, config: { event: "boss:enrage" } },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "flow", target: "n2", targetHandle: "flow" },
      { id: "e2", source: "n2", sourceHandle: "value", target: "n3", targetHandle: "a" },
      { id: "e3", source: "n3", sourceHandle: "result", target: "n4", targetHandle: "condition" },
      { id: "e4", source: "n4", sourceHandle: "true", target: "n5", targetHandle: "flow" },
    ],
  },
};
