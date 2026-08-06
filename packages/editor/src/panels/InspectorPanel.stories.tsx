import type { Meta, StoryObj } from "@storybook/react";
import { InspectorPanel } from "./InspectorPanel";

const meta: Meta<typeof InspectorPanel> = {
  title: "Editor/InspectorPanel",
  component: InspectorPanel,
};
export default meta;

type Story = StoryObj<typeof InspectorPanel>;

export const Loading: Story = { args: { state: "loading" } };
export const Empty: Story = { args: { state: "empty" } };
export const ErrorState: Story = { name: "Error", args: { state: "error", onRetry: () => {} } };
export const PermissionDenied: Story = { args: { state: "permission-denied" } };
export const Offline: Story = { args: { state: "offline" } };
export const Populated: Story = {
  args: { state: "populated", selectionLabel: "NPC: Shopkeeper (entity #3)" },
};
