import type { Meta, StoryObj } from "@storybook/react";
import { Tree } from "./Tree";

const meta: Meta<typeof Tree> = {
  title: "Primitives/Tree",
  component: Tree,
};
export default meta;

type Story = StoryObj<typeof Tree>;

const sceneNodes = [
  {
    id: "scenes",
    label: "Scenes",
    children: [
      { id: "village", label: "village" },
      { id: "cave-01", label: "cave-01" },
    ],
  },
  {
    id: "entities",
    label: "Entities",
    children: [
      { id: "goblin", label: "Goblin" },
      { id: "player", label: "Player" },
    ],
  },
];

export const Loading: Story = {
  args: { label: "Project tree", state: "loading" },
};

export const Empty: Story = {
  args: {
    label: "Project tree",
    state: "empty",
    empty: {
      title: "No scenes yet",
      description: "Create your first scene to see it here.",
      actionLabel: "Create a scene",
      onAction: () => {},
    },
  },
};

export const ErrorState: Story = {
  name: "Error",
  args: {
    label: "Project tree",
    state: "error",
    error: {
      title: "Couldn't load the project tree",
      description: "The project document failed to parse. Try reloading.",
      onRetry: () => {},
    },
  },
};

export const PermissionDenied: Story = {
  args: {
    label: "Project tree",
    state: "permission-denied",
    permissionDenied: {
      title: "You have view access to this project",
      description: "Ask the project owner for editor access to make changes.",
    },
  },
};

export const Offline: Story = {
  args: {
    label: "Project tree",
    state: "offline",
    offline: {
      title: "Offline — changes stored locally",
      description: "The tree reflects your local journal and will sync on reconnect.",
    },
  },
};

export const Populated: Story = {
  args: { label: "Project tree", state: "populated", nodes: sceneNodes },
};
