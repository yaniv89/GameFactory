import type { Meta, StoryObj } from "@storybook/react";
import { HistoryPanel } from "./HistoryPanel";

const meta: Meta<typeof HistoryPanel> = {
  title: "Editor/HistoryPanel",
  component: HistoryPanel,
};
export default meta;

type Story = StoryObj<typeof HistoryPanel>;

export const Loading: Story = {
  args: { state: "loading" },
};

export const Empty: Story = {
  args: { state: "empty", onSaveNow: () => {} },
};

export const ErrorState: Story = {
  name: "Error",
  args: { state: "error", onRetry: () => {} },
};

export const PermissionDenied: Story = {
  args: { state: "permission-denied" },
};

export const Offline: Story = {
  args: { state: "offline" },
};

export const Populated: Story = {
  args: {
    state: "populated",
    revisions: [
      { id: 12, label: undefined, isCheckpoint: false, createdAt: "2026-08-16T12:34:00Z", isCurrent: true },
      { id: 11, label: "Added the cave entrance", isCheckpoint: false, createdAt: "2026-08-16T11:02:00Z", isCurrent: false },
      { id: 8, label: "Before the pack swap", isCheckpoint: true, createdAt: "2026-08-15T09:15:00Z", isCurrent: false },
    ],
    onRestore: () => {},
  },
};

export const PopulatedWithMore: Story = {
  name: "Populated (more available)",
  args: {
    ...Populated.args,
    hasMore: true,
    onLoadMore: () => {},
  },
};

export const RestoringInProgress: Story = {
  name: "Restoring in progress",
  args: {
    ...Populated.args,
    restoringId: 8,
  },
};
