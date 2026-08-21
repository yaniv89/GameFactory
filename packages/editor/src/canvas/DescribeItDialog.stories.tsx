import type { Meta, StoryObj } from "@storybook/react";
import type { GenerationRequestResult } from "../api/artGenerationApi";
import { DescribeItDialog } from "./DescribeItDialog";

const meta: Meta<typeof DescribeItDialog> = {
  title: "Editor/DescribeItDialog",
  component: DescribeItDialog,
};
export default meta;

type Story = StoryObj<typeof DescribeItDialog>;

const NOOP = () => {};
const NO_THUMBNAIL = async () => undefined;

function makeRequest(overrides: Partial<GenerationRequestResult> = {}): GenerationRequestResult {
  return {
    id: "req1",
    category: "tile",
    status: "awaiting_confirmation",
    expandedPrompt:
      "A seamless, tileable ground texture: weathered gray stone with a faint moss overlay in the cracks, top-down orthographic lighting, no visible seams at the tile edges.",
    errorMessage: undefined,
    createdAt: "2026-01-01T00:00:00Z",
    variations: [],
    ...overrides,
  };
}

const BASE_ARGS = {
  open: true,
  onClose: NOOP,
  submitting: false,
  submitError: undefined,
  retryAfterSeconds: undefined,
  onSubmit: NOOP,
  request: undefined,
  pollState: "loading" as const,
  pollError: undefined,
  confirming: false,
  confirmError: undefined,
  onConfirm: NOOP,
  onStartOver: NOOP,
  selecting: false,
  selectError: undefined,
  onSelect: async () => undefined,
  loadVariationThumbnail: NO_THUMBNAIL,
};

// The compose step's own CLAUDE.md 5.4 states: this atomic form has no
// background fetch to be loading/empty/offline about before the creator
// types anything (LoginView.tsx's own precedent for a "single atomic
// form, not a data view") -- its real states are the ones below: a fresh
// form, a validation error, a submit error (with and without a
// rate-limit's own retry-after), and mid-submit.

export const ComposeEmpty: Story = {
  args: { ...BASE_ARGS },
};

export const ComposeSubmitting: Story = {
  args: { ...BASE_ARGS, submitting: true },
};

/** A Free-tier workspace's own 402 message, verbatim from CreateGenerationRequestEndpoint's plan-gate failure. */
export const ComposePlanGateError: Story = {
  args: { ...BASE_ARGS, submitError: "This action requires a Pro or Studio plan. Upgrade your workspace to continue." },
};

/** CLAUDE.md 4.8: Retry-After surfaced in the UI, not just a generic "try again." */
export const ComposeRateLimited: Story = {
  args: { ...BASE_ARGS, submitError: "Too many art-generation requests. Slow down and try again shortly.", retryAfterSeconds: 180 },
};

export const Confirm: Story = {
  args: { ...BASE_ARGS, request: makeRequest() },
};

export const Confirming: Story = {
  args: { ...BASE_ARGS, request: makeRequest(), confirming: true },
};

// The poll phase's own six states (CLAUDE.md 5.4) -- this is the one
// real background fetch in this dialog (Forge.Functions.ArtGen's own
// async claim/generate/finish cycle, N3/N4), so it's the phase these
// apply to directly.

export const ProgressLoading: Story = {
  name: "Progress — Loading",
  args: { ...BASE_ARGS, request: makeRequest({ status: "queued" }), pollState: "loading" },
};

export const ProgressGenerating: Story = {
  name: "Progress — Populated (generating)",
  args: { ...BASE_ARGS, request: makeRequest({ status: "generating" }), pollState: "populated" },
};

export const ProgressError: Story = {
  name: "Progress — Error",
  args: {
    ...BASE_ARGS,
    request: makeRequest({ status: "queued" }),
    pollState: "error",
    pollError: "The request timed out. Your connection may be slow, or the server may be unavailable.",
  },
};

export const ProgressOffline: Story = {
  name: "Progress — Offline",
  args: { ...BASE_ARGS, request: makeRequest({ status: "queued" }), pollState: "offline" },
};

export const ProgressPermissionDenied: Story = {
  name: "Progress — Permission denied",
  args: { ...BASE_ARGS, request: makeRequest({ status: "generating" }), pollState: "permission-denied" },
};

export const Declined: Story = {
  args: {
    ...BASE_ARGS,
    request: makeRequest({
      status: "declined",
      errorMessage: "This description couldn't be generated — it appears to reference a real, identifiable person.",
    }),
  },
};

export const Failed: Story = {
  args: {
    ...BASE_ARGS,
    request: makeRequest({ status: "failed", errorMessage: "None of the generated images were usable: every variation failed decode safety." }),
  },
};

export const ReadyEmpty: Story = {
  name: "Ready — Populated",
  args: {
    ...BASE_ARGS,
    request: makeRequest({
      status: "ready",
      variations: [
        { id: "v1", width: 128, height: 128, selected: false },
        { id: "v2", width: 128, height: 128, selected: false },
        { id: "v3", width: 128, height: 128, selected: false },
        { id: "v4", width: 128, height: 128, selected: true },
      ],
    }),
  },
};

export const ReadySelecting: Story = {
  name: "Ready — Saving",
  args: {
    ...BASE_ARGS,
    request: makeRequest({ status: "ready", variations: [{ id: "v1", width: 128, height: 128, selected: false }] }),
    selecting: true,
  },
};

export const ReadySelectError: Story = {
  name: "Ready — Select error",
  args: {
    ...BASE_ARGS,
    request: makeRequest({ status: "ready", variations: [{ id: "v1", width: 128, height: 128, selected: false }] }),
    selectError: "This workspace has used 480 of 500 MB. Delete an asset, or upgrade the plan for more storage.",
  },
};
