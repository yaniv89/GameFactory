import type { Meta, StoryObj } from "@storybook/react";
import { SceneInspector } from "../inspector/SceneInspector";
import { InspectorPanel } from "./InspectorPanel";

const meta: Meta<typeof InspectorPanel> = {
  title: "Editor/InspectorPanel",
  component: InspectorPanel,
};
export default meta;

type Story = StoryObj<typeof InspectorPanel>;

export const Loading: Story = { args: { state: "loading" } };
export const Empty: Story = { args: { state: "empty" } };
export const ErrorState: Story = { name: "Error", args: { state: "error", onRetry: () => {} } };
export const PermissionDenied: Story = { args: { state: "permission-denied" } };
export const Offline: Story = { args: { state: "offline" } };
export const Populated: Story = {
  args: { state: "populated", selectionLabel: "NPC: Shopkeeper (entity #3)" },
};

/** A real, JSON-Schema-driven property form (Phase 4), not placeholder markup. */
export const PopulatedWithSceneInspector: Story = {
  render: () => (
    <InspectorPanel state="populated" selectionLabel="Scene: Village">
      <SceneInspector scene={{ id: "s1", name: "Village", entities: [], tiles: [] }} onRename={() => {}} />
    </InspectorPanel>
  ),
};
