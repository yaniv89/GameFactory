import type { Meta, StoryObj } from "@storybook/react";
import { GraphsPanel } from "./GraphsPanel";

const meta: Meta<typeof GraphsPanel> = {
  title: "Editor/GraphsPanel",
  component: GraphsPanel,
};
export default meta;

type Story = StoryObj<typeof GraphsPanel>;

const NOOP = () => {};
const BASE_ARGS = { onCreateGraph: NOOP, onRenameGraph: NOOP, onOpenGraph: NOOP, onDeleteGraph: NOOP };

export const Loading: Story = { args: { state: "loading", ...BASE_ARGS } };
export const Empty: Story = { args: { state: "empty", ...BASE_ARGS } };
export const ErrorState: Story = { name: "Error", args: { state: "error", ...BASE_ARGS, onRetry: NOOP } };
export const PermissionDenied: Story = { args: { state: "permission-denied", ...BASE_ARGS } };
export const Offline: Story = { args: { state: "offline", ...BASE_ARGS } };
export const Populated: Story = {
  args: {
    state: "populated",
    ...BASE_ARGS,
    graphs: [
      { id: "g1", name: "Boss fight logic", nodeCount: 12 },
      { id: "g2", name: "Shop keeper dialogue", nodeCount: 4 },
      { id: "g3", name: "New graph", nodeCount: 0 },
    ],
  },
};
