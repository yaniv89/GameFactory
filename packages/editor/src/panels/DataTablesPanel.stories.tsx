import type { Meta, StoryObj } from "@storybook/react";
import { DataTablesPanel } from "./DataTablesPanel";

const meta: Meta<typeof DataTablesPanel> = {
  title: "Editor/DataTablesPanel",
  component: DataTablesPanel,
};
export default meta;

type Story = StoryObj<typeof DataTablesPanel>;

const NOOP = () => {};
const BASE_ARGS = { onCreateTable: NOOP, onRenameTable: NOOP, onOpenTable: NOOP, onDeleteTable: NOOP };

export const Loading: Story = { args: { state: "loading", ...BASE_ARGS } };
export const Empty: Story = { args: { state: "empty", ...BASE_ARGS } };
export const ErrorState: Story = { name: "Error", args: { state: "error", ...BASE_ARGS, onRetry: NOOP } };
export const PermissionDenied: Story = { args: { state: "permission-denied", ...BASE_ARGS } };
export const Offline: Story = { args: { state: "offline", ...BASE_ARGS } };
export const Populated: Story = {
  args: {
    state: "populated",
    ...BASE_ARGS,
    tables: [
      { id: "t1", name: "Loot Table", columnCount: 3, rowCount: 12 },
      { id: "t2", name: "Shop Stock", columnCount: 2, rowCount: 5 },
      { id: "t3", name: "New Table", columnCount: 0, rowCount: 0 },
    ],
  },
};
