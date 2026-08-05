import type { Meta, StoryObj } from "@storybook/react";
import { Checkbox } from "./Checkbox";

const meta: Meta<typeof Checkbox> = {
  title: "Primitives/Checkbox",
  component: Checkbox,
};
export default meta;

type Story = StoryObj<typeof Checkbox>;

export const Unchecked: Story = {
  args: { label: "Enable cloud saves" },
};

export const Checked: Story = {
  args: { label: "Enable cloud saves", defaultChecked: true },
};

export const Indeterminate: Story = {
  args: { label: "Select all scenes", indeterminate: true },
};

export const Disabled: Story = {
  args: { label: "Pixel-perfect rendering", disabled: true, defaultChecked: true },
};
