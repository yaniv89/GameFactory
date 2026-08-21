import type { Meta, StoryObj } from "@storybook/react";
import { DataTableEditorDialog } from "./DataTableEditorDialog";

const meta: Meta<typeof DataTableEditorDialog> = {
  title: "Editor/DataTableEditorDialog",
  component: DataTableEditorDialog,
};
export default meta;

type Story = StoryObj<typeof DataTableEditorDialog>;

const NOOP = () => {};

export const Empty: Story = {
  args: { open: true, onClose: NOOP, tableName: "New Table", columns: [], rows: [], onChange: NOOP },
};

export const OneColumnNoRows: Story = {
  args: {
    open: true,
    onClose: NOOP,
    tableName: "Loot Table",
    columns: [{ id: "id", name: "Item ID", type: "string" }],
    rows: [],
    onChange: NOOP,
  },
};

export const Populated: Story = {
  args: {
    open: true,
    onClose: NOOP,
    tableName: "Loot Table",
    columns: [
      { id: "id", name: "Item ID", type: "string" },
      { id: "weight", name: "Drop Weight", type: "number" },
      { id: "rare", name: "Rare", type: "boolean" },
    ],
    rows: [
      { id: "sword", weight: 5, rare: false },
      { id: "shield", weight: 3, rare: false },
      { id: "legendary-orb", weight: 1, rare: true },
    ],
    onChange: NOOP,
  },
};
