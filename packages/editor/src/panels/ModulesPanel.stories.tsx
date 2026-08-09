import type { Meta, StoryObj } from "@storybook/react";
import { ModulesPanel } from "./ModulesPanel";

const meta: Meta<typeof ModulesPanel> = {
  title: "Editor/ModulesPanel",
  component: ModulesPanel,
};
export default meta;

type Story = StoryObj<typeof ModulesPanel>;

const NOOP = () => {};
const BASE_ARGS = { onInstall: NOOP, onUninstall: NOOP, onConfigure: NOOP, onBrowseMarketplace: NOOP };

export const Loading: Story = { args: { state: "loading", ...BASE_ARGS } };
export const Empty: Story = { args: { state: "empty", ...BASE_ARGS } };
export const ErrorState: Story = { name: "Error", args: { state: "error", ...BASE_ARGS, onRetry: NOOP } };
export const PermissionDenied: Story = { args: { state: "permission-denied", ...BASE_ARGS } };
export const Offline: Story = { args: { state: "offline", ...BASE_ARGS } };
export const Populated: Story = {
  args: {
    state: "populated",
    ...BASE_ARGS,
    modules: [
      { name: "@forge/dialogue", summary: "Dialogue trees with translatable, filterable lines.", installed: true, configurable: false },
      {
        name: "@forge/inventory",
        summary: "Per-entity item stacks, capacity limits, and a shop flow.",
        installed: true,
        configurable: true,
      },
      {
        name: "@forge/turn-battle",
        summary: "1v1 turn-based combat with hit chance and damage filters.",
        installed: false,
        configurable: true,
      },
    ],
  },
};
