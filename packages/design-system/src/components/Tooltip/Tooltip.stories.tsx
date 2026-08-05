import type { Meta, StoryObj } from "@storybook/react";
import { Tooltip } from "./Tooltip";
import { Button } from "../Button/Button";

const meta: Meta<typeof Tooltip> = {
  title: "Primitives/Tooltip",
  component: Tooltip,
};
export default meta;

type Story = StoryObj<typeof Tooltip>;

export const Default: Story = {
  args: {
    content: "Undo (Cmd+Z)",
    children: <Button variant="ghost">Undo</Button>,
  },
};

export const OnIconButton: Story = {
  args: {
    content: "Close panel",
    children: (
      <Button variant="ghost" iconOnly aria-label="Close panel">
        ✕
      </Button>
    ),
  },
};
