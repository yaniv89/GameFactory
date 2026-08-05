import type { Meta, StoryObj } from "@storybook/react";
import { Select } from "./Select";

const options = [
  { value: "topdown-rpg", label: "Top-down RPG" },
  { value: "sim", label: "Simulation" },
  { value: "idle", label: "Idle / incremental" },
];

const meta: Meta<typeof Select> = {
  title: "Primitives/Select",
  component: Select,
};
export default meta;

type Story = StoryObj<typeof Select>;

export const Default: Story = {
  args: { label: "Genre template", options, defaultValue: "topdown-rpg" },
};

export const WithPlaceholder: Story = {
  args: { label: "Active art pack", options, placeholder: "Choose a pack…" },
};

export const WithError: Story = {
  args: {
    label: "Genre template",
    options,
    placeholder: "Choose a template…",
    error: "A genre template is required to create a project.",
  },
};

export const Disabled: Story = {
  args: { label: "Genre template", options, defaultValue: "topdown-rpg", disabled: true },
};
