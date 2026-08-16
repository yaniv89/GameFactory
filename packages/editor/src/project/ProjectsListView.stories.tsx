import type { Meta, StoryObj } from "@storybook/react";
import { ProjectsListView } from "./ProjectsListView";

const meta: Meta<typeof ProjectsListView> = {
  title: "Editor/ProjectsListView",
  component: ProjectsListView,
};
export default meta;

type Story = StoryObj<typeof ProjectsListView>;

const noop = () => {};

const BASE = {
  workspaceName: "Ada's Workspace",
  projects: [],
  error: undefined,
  creating: false,
  createError: undefined,
  onRetry: noop,
  onSignOut: noop,
  onOpenProject: noop,
  onCreateProject: noop,
};

export const Loading: Story = {
  args: { ...BASE, state: "loading" },
};

export const Empty: Story = {
  args: { ...BASE, state: "empty" },
};

export const ErrorState: Story = {
  name: "Error",
  args: { ...BASE, state: "error", error: "The request timed out." },
};

export const PermissionDenied: Story = {
  args: { ...BASE, state: "permission-denied" },
};

export const Offline: Story = {
  args: { ...BASE, state: "offline" },
};

export const Populated: Story = {
  args: {
    ...BASE,
    state: "populated",
    projects: [
      {
        id: "11111111-1111-1111-1111-111111111111",
        workspaceId: "ws-1",
        slug: "starter-rpg",
        title: "Starter RPG",
        visibility: "private",
        headRevision: 12,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-08-10T00:00:00Z",
      },
      {
        id: "22222222-2222-2222-2222-222222222222",
        workspaceId: "ws-1",
        slug: "dungeon-crawler",
        title: "Dungeon Crawler",
        visibility: "private",
        headRevision: undefined,
        createdAt: "2026-08-15T00:00:00Z",
        updatedAt: "2026-08-15T00:00:00Z",
      },
    ],
  },
};

export const CreatingWithError: Story = {
  args: { ...BASE, state: "populated", creating: false, createError: "A project with this name already exists." },
};
