import type { Meta, StoryObj } from "@storybook/react";
import { PresenceIndicatorView } from "./PresenceIndicator";

const meta: Meta<typeof PresenceIndicatorView> = {
  title: "Editor/PresenceIndicator",
  component: PresenceIndicatorView,
};
export default meta;

type Story = StoryObj<typeof PresenceIndicatorView>;

export const Loading: Story = {
  args: { status: "loading", roster: [] },
};

export const ErrorState: Story = {
  name: "Error",
  args: { status: "error", roster: [] },
};

export const Offline: Story = {
  args: { status: "offline", roster: [] },
};

export const Populated: Story = {
  args: {
    status: "populated",
    roster: [
      { connectionId: "a", userId: "u1", displayName: "Ada Lovelace" },
      { connectionId: "b", userId: "u2", displayName: "Grace Hopper" },
      { connectionId: "c", userId: "u3", displayName: "Margaret Hamilton" },
    ],
  },
};

export const PopulatedJustYou: Story = {
  name: "Populated (just you — the only reachable 'alone' state)",
  args: {
    status: "populated",
    roster: [{ connectionId: "a", userId: "u1", displayName: "Ada Lovelace" }],
  },
};
