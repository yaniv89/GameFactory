import type { Meta, StoryObj } from "@storybook/react";
import { Panel } from "./Panel";

const meta: Meta<typeof Panel> = {
  title: "Primitives/Panel",
  component: Panel,
};
export default meta;

type Story = StoryObj<typeof Panel>;

// The six required states from CLAUDE.md 5.4, using the Scenes panel copy
// from 5.5 as the worked example.

export const Loading: Story = {
  args: { title: "Scenes", state: "loading" },
};

export const Empty: Story = {
  args: {
    title: "Scenes",
    state: "empty",
    empty: {
      title: "No scenes yet",
      description:
        "A scene is one map, menu, or battle screen. Most games start with a town or a starting room.",
      actionLabel: "Create a scene",
      onAction: () => {},
    },
  },
};

export const ErrorState: Story = {
  name: "Error",
  args: {
    title: "Scenes",
    state: "error",
    error: {
      title: "Couldn't load scenes",
      description:
        "The request timed out. Your connection may be slow or the project may be very large.",
      onRetry: () => {},
    },
  },
};

export const PermissionDenied: Story = {
  args: {
    title: "Scenes",
    state: "permission-denied",
    permissionDenied: {
      title: "You have view access to this project",
      description: "Ask Dana (owner) for editor access to make changes.",
    },
  },
};

export const Offline: Story = {
  args: {
    title: "Scenes",
    state: "offline",
    offline: {
      title: "Offline — changes stored locally",
      description: "Scenes will sync automatically when you reconnect.",
    },
  },
};

export const Populated: Story = {
  args: {
    title: "Scenes",
    state: "populated",
    children: (
      <ul style={{ margin: 0, paddingInlineStart: "1.2em" }}>
        <li>village</li>
        <li>cave-01</li>
      </ul>
    ),
  },
};
