import type { Meta, StoryObj } from "@storybook/react";
import { Textarea } from "./Textarea";

const meta: Meta<typeof Textarea> = {
  title: "Primitives/Textarea",
  component: Textarea,
};
export default meta;

type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: { label: "Describe it", placeholder: "A mossy stone tile with faint cracks" },
};

export const WithHint: Story = {
  args: {
    label: "Describe it",
    hint: "One or two sentences. The more specific, the better the result.",
  },
};

export const WithError: Story = {
  args: {
    label: "Describe it",
    defaultValue: "",
    error: "Describe what you want before generating.",
  },
};

export const Disabled: Story = {
  args: { label: "Describe it", defaultValue: "A mossy stone tile", disabled: true },
};
