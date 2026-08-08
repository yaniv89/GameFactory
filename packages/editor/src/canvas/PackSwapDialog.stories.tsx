import type { Meta, StoryObj } from "@storybook/react";
import { PackSwapDialog } from "./PackSwapDialog";

const meta: Meta<typeof PackSwapDialog> = {
  title: "Editor/PackSwapDialog",
  component: PackSwapDialog,
};
export default meta;

type Story = StoryObj<typeof PackSwapDialog>;

const NOOP = () => {};
const BASE_ARGS = {
  open: true,
  onClose: NOOP,
  currentPackName: "@pixelfoundry/fantasy-pack",
  availablePackNames: ["@pixelfoundry/fantasy-pack", "@moonlit/scifi-pack"],
  onSelectTarget: NOOP,
  onRetryDiff: NOOP,
  applying: false,
  onApply: NOOP,
  checkpoints: [],
  onRestoreCheckpoint: NOOP,
  onDeleteCheckpoint: NOOP,
};

export const NoTargetChosen: Story = {
  args: { ...BASE_ARGS, targetPackName: undefined, diffState: "loading", findings: [] },
};

export const Loading: Story = {
  args: { ...BASE_ARGS, targetPackName: "@moonlit/scifi-pack", diffState: "loading", findings: [] },
};

export const ErrorState: Story = {
  name: "Error",
  args: {
    ...BASE_ARGS,
    targetPackName: "@moonlit/scifi-pack",
    diffState: "error",
    findings: [],
    errorMessage: "The target pack's manifest failed schema validation.",
  },
};

export const Offline: Story = {
  args: {
    ...BASE_ARGS,
    targetPackName: "@moonlit/scifi-pack",
    diffState: "offline",
    findings: [],
    errorMessage: "Failed to fetch",
  },
};

export const PermissionDenied: Story = {
  args: { ...BASE_ARGS, targetPackName: "@moonlit/scifi-pack", diffState: "permission-denied", findings: [] },
};

/**
 * docs/SPEC.md Section 11.5's own worked example, reproduced with real
 * `diffPackSwap` output shapes (see @forge/art-pack's diffPackSwap.test.ts
 * for the scenario this mirrors).
 */
export const Populated: Story = {
  args: {
    ...BASE_ARGS,
    targetPackName: "@moonlit/scifi-pack",
    diffState: "populated",
    findings: [
      { severity: "ok", message: "118 tiles map by terrain tag" },
      { severity: "ok", message: "12 character sheets map by role tag" },
      { severity: "warn", message: "Tile size differs (32 -> 16)", detail: "Scenes will be rescaled." },
      {
        severity: "warn",
        message: "'attack' animation has 4 frames in target, 6 in source",
        detail: "Timing will be resampled.",
      },
      {
        severity: "fail",
        message: "3 props have no equivalent: 'well', 'market-stall', 'signpost'",
        detail: "These will render as placeholders until remapped.",
      },
    ],
  },
};

export const PopulatedCleanSwap: Story = {
  args: {
    ...BASE_ARGS,
    targetPackName: "@moonlit/scifi-pack",
    diffState: "populated",
    findings: [
      { severity: "ok", message: "3 tiles map by terrain tag" },
      { severity: "ok", message: "2 character sheets map by role tag" },
    ],
  },
};

export const NoActivePackYet: Story = {
  args: {
    ...BASE_ARGS,
    currentPackName: undefined,
    targetPackName: "@pixelfoundry/fantasy-pack",
    diffState: "populated",
    findings: [{ severity: "ok", message: "No pack is currently active — this installs @pixelfoundry/fantasy-pack directly." }],
  },
};

export const Applying: Story = {
  args: {
    ...BASE_ARGS,
    targetPackName: "@moonlit/scifi-pack",
    diffState: "populated",
    findings: [{ severity: "ok", message: "3 tiles map by terrain tag" }],
    applying: true,
  },
};

export const WithCheckpoints: Story = {
  args: {
    ...BASE_ARGS,
    targetPackName: undefined,
    diffState: "loading",
    findings: [],
    checkpoints: [
      { id: "c2", label: "Before switching from @pixelfoundry/fantasy-pack to @moonlit/scifi-pack", createdAt: "2026-08-08T14:32:00.000Z" },
      { id: "c1", label: "Before installing @pixelfoundry/fantasy-pack", createdAt: "2026-08-01T09:05:00.000Z" },
    ],
  },
};
