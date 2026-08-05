import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./Input";

const meta: Meta<typeof Input> = {
  title: "Primitives/Input",
  component: Input,
};
export default meta;

type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: { label: "Project title", placeholder: "The Hollow Crown" },
};

export const WithHint: Story = {
  args: {
    label: "Tile size",
    hint: "Must be between 8 and 128 pixels.",
    defaultValue: "32",
  },
};

/** Error copy follows CLAUDE.md 5.6: what happened, why, what to do. */
export const WithError: Story = {
  args: {
    label: "Tile size",
    defaultValue: "512",
    error: "Tile size must be between 8 and 128. You entered 512.",
  },
};

export const Required: Story = {
  args: { label: "Workspace slug", required: true },
};

export const Disabled: Story = {
  args: { label: "Engine version", defaultValue: "2.4.0", disabled: true },
};
