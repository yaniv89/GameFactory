import type { Meta, StoryObj } from "@storybook/react";
import { Menu } from "./Menu";

const meta: Meta<typeof Menu> = {
  title: "Primitives/Menu",
  component: Menu,
};
export default meta;

type Story = StoryObj<typeof Menu>;

export const Default: Story = {
  args: {
    label: "Scene actions",
    items: [
      { id: "rename", label: "Rename" },
      { id: "duplicate", label: "Duplicate" },
      { id: "delete", label: "Delete", destructive: true },
    ],
  },
};

export const WithDisabledItem: Story = {
  args: {
    label: "Module actions",
    items: [
      { id: "configure", label: "Configure" },
      { id: "update", label: "Update", disabled: true },
      { id: "uninstall", label: "Uninstall", destructive: true },
    ],
  },
};
