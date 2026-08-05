import type { Meta, StoryObj } from "@storybook/react";
import { StatusBar } from "./StatusBar";

const meta: Meta<typeof StatusBar> = {
  title: "Primitives/StatusBar",
  component: StatusBar,
};
export default meta;

type Story = StoryObj<typeof StatusBar>;

export const Saved: Story = { args: { status: "saved" } };
export const Saving: Story = { args: { status: "saving" } };
export const Unsaved: Story = { args: { status: "unsaved" } };
export const Offline: Story = { args: { status: "offline" } };
