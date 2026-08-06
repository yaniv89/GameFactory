import type { Meta, StoryObj } from "@storybook/react";
import { ScenesPanel } from "./ScenesPanel";

const meta: Meta<typeof ScenesPanel> = {
  title: "Editor/ScenesPanel",
  component: ScenesPanel,
};
export default meta;

type Story = StoryObj<typeof ScenesPanel>;

export const Loading: Story = {
  args: { state: "loading", onCreateScene: () => {} },
};

export const Empty: Story = {
  args: { state: "empty", onCreateScene: () => {} },
};

export const ErrorState: Story = {
  name: "Error",
  args: { state: "error", onCreateScene: () => {}, onRetry: () => {} },
};

export const PermissionDenied: Story = {
  args: { state: "permission-denied", onCreateScene: () => {} },
};

export const Offline: Story = {
  args: { state: "offline", onCreateScene: () => {} },
};

export const Populated: Story = {
  args: { state: "populated", scenes: ["village", "cave-01"], onCreateScene: () => {} },
};
