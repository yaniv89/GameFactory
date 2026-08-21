import type { Meta, StoryObj } from "@storybook/react";
import { QuestsPanel } from "./QuestsPanel";

const meta: Meta<typeof QuestsPanel> = {
  title: "Editor/QuestsPanel",
  component: QuestsPanel,
};
export default meta;

type Story = StoryObj<typeof QuestsPanel>;

const NOOP = () => {};
const BASE_ARGS = {
  onCreateQuest: NOOP,
  onEditQuest: NOOP,
  onDeleteQuest: NOOP,
  onAddObjective: NOOP,
  onEditObjective: NOOP,
  onRemoveObjective: NOOP,
};

export const Loading: Story = { args: { state: "loading", ...BASE_ARGS } };
export const Empty: Story = { args: { state: "empty", ...BASE_ARGS } };
export const ErrorState: Story = { name: "Error", args: { state: "error", ...BASE_ARGS, onRetry: NOOP } };
export const PermissionDenied: Story = { args: { state: "permission-denied", ...BASE_ARGS } };
export const Offline: Story = { args: { state: "offline", ...BASE_ARGS } };
export const Populated: Story = {
  args: {
    state: "populated",
    ...BASE_ARGS,
    quests: [
      {
        id: "q1",
        name: "Wolf Trouble",
        description: "Deal with the wolves near the mill.",
        objectives: [
          { id: "o1", description: "Kill 3 wolves" },
          { id: "o2", description: "Report back to the elder" },
        ],
      },
      { id: "q2", name: "New quest", description: "", objectives: [] },
    ],
  },
};
