import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "Primitives/Button",
  component: Button,
};
export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = {
  args: { variant: "primary", children: "Create scene" },
};

export const Secondary: Story = {
  args: { variant: "secondary", children: "Cancel" },
};

export const Destructive: Story = {
  args: { variant: "destructive", children: "Delete project" },
};

export const Ghost: Story = {
  args: { variant: "ghost", children: "Dismiss" },
};

/** Disabled control state — not part of the six-state view framework, see Button.tsx. */
export const Disabled: Story = {
  args: { variant: "primary", children: "Publish", disabled: true },
};

export const Loading: Story = {
  args: { variant: "primary", children: "Publishing…", loading: true },
};

export const IconOnly: Story = {
  args: { variant: "ghost", iconOnly: true, "aria-label": "Close", children: "✕" },
};
