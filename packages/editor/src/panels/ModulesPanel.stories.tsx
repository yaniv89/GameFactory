import type { Meta, StoryObj } from "@storybook/react";
import { ModulesPanel } from "./ModulesPanel";

const meta: Meta<typeof ModulesPanel> = {
  title: "Editor/ModulesPanel",
  component: ModulesPanel,
};
export default meta;

type Story = StoryObj<typeof ModulesPanel>;

export const Loading: Story = { args: { state: "loading", onBrowseMarketplace: () => {} } };
export const Empty: Story = { args: { state: "empty", onBrowseMarketplace: () => {} } };
export const ErrorState: Story = {
  name: "Error",
  args: { state: "error", onBrowseMarketplace: () => {}, onRetry: () => {} },
};
export const PermissionDenied: Story = { args: { state: "permission-denied", onBrowseMarketplace: () => {} } };
export const Offline: Story = { args: { state: "offline", onBrowseMarketplace: () => {} } };
export const Populated: Story = {
  args: {
    state: "populated",
    onBrowseMarketplace: () => {},
    modules: [
      { name: "@forge/dialogue", summary: "Dialogue trees with translatable, filterable lines." },
      { name: "@forge/inventory", summary: "Per-entity item stacks, capacity limits, and a shop flow." },
      { name: "@forge/turn-battle", summary: "1v1 turn-based combat with hit chance and damage filters." },
    ],
  },
};
