import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { GenerationRequestResult } from "../api/artGenerationApi";
import { DescribeItDialog } from "./DescribeItDialog";

const NOOP = () => {};
const NO_THUMBNAIL = async () => undefined;

function makeRequest(overrides: Partial<GenerationRequestResult> = {}): GenerationRequestResult {
  return {
    id: "req1",
    category: "tile",
    status: "awaiting_confirmation",
    expandedPrompt: "A seamless, tileable mossy stone texture.",
    errorMessage: undefined,
    createdAt: "2026-01-01T00:00:00Z",
    variations: [],
    ...overrides,
  };
}

const BASE_PROPS = {
  open: true,
  onClose: NOOP,
  submitting: false,
  submitError: undefined as string | undefined,
  retryAfterSeconds: undefined as number | undefined,
  onSubmit: NOOP,
  request: undefined as GenerationRequestResult | undefined,
  pollState: "loading" as const,
  pollError: undefined as string | undefined,
  confirming: false,
  confirmError: undefined as string | undefined,
  onConfirm: NOOP,
  onStartOver: NOOP,
  selecting: false,
  selectError: undefined as string | undefined,
  onSelect: async () => undefined,
  loadVariationThumbnail: NO_THUMBNAIL,
};

describe("DescribeItDialog", () => {
  it("compose: rejects an empty prompt and never calls onSubmit", async () => {
    const onSubmit = vi.fn();
    render(<DescribeItDialog {...BASE_PROPS} onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(await screen.findByText("Describe what you want before generating.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("compose: submits the trimmed prompt and chosen category", async () => {
    const onSubmit = vi.fn();
    render(<DescribeItDialog {...BASE_PROPS} onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText("Describe it"), "  a mossy stone tile  ");
    await userEvent.selectOptions(screen.getByLabelText("Kind"), "prop");
    await userEvent.click(screen.getByRole("button", { name: "Generate" }));

    expect(onSubmit).toHaveBeenCalledWith("a mossy stone tile", "prop");
  });

  it("compose: shows a submit error with the retry-after seconds appended", () => {
    render(<DescribeItDialog {...BASE_PROPS} submitError="Too many requests." retryAfterSeconds={42} />);

    expect(screen.getByText("Too many requests. Try again in 42 seconds.")).toBeInTheDocument();
  });

  it("confirm: shows the expanded prompt and lets a person confirm or start over", async () => {
    const onConfirm = vi.fn();
    const onStartOver = vi.fn();
    render(<DescribeItDialog {...BASE_PROPS} request={makeRequest()} onConfirm={onConfirm} onStartOver={onStartOver} />);

    expect(screen.getByText("A seamless, tileable mossy stone texture.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Generate images" }));
    expect(onConfirm).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Start over" }));
    expect(onStartOver).toHaveBeenCalled();
  });

  it("progress: shows a generating message while queued/generating and polling succeeds", () => {
    render(<DescribeItDialog {...BASE_PROPS} request={makeRequest({ status: "generating" })} pollState="populated" />);

    expect(screen.getByText("Generating your art…")).toBeInTheDocument();
  });

  it("progress: shows the offline state without implying the poll gave up", () => {
    render(<DescribeItDialog {...BASE_PROPS} request={makeRequest({ status: "queued" })} pollState="offline" />);

    expect(screen.getByText("Offline — can't check on this generation")).toBeInTheDocument();
  });

  it("progress: shows a transient poll error but says it's retrying automatically", () => {
    render(
      <DescribeItDialog
        {...BASE_PROPS}
        request={makeRequest({ status: "queued" })}
        pollState="error"
        pollError="The request timed out."
      />,
    );

    expect(screen.getByText(/Couldn't check on this generation/)).toBeInTheDocument();
    expect(screen.getByText(/Checking again automatically/)).toBeInTheDocument();
  });

  it("progress: shows permission-denied without a retry affordance", () => {
    render(<DescribeItDialog {...BASE_PROPS} request={makeRequest({ status: "queued" })} pollState="permission-denied" />);

    expect(screen.getByText("This generation is no longer available")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("terminal-error: shows the decline reason distinctly from a harness failure", () => {
    const { rerender } = render(
      <DescribeItDialog {...BASE_PROPS} request={makeRequest({ status: "declined", errorMessage: "Policy violation: weapons." })} />,
    );
    expect(screen.getByText("This description was declined")).toBeInTheDocument();
    expect(screen.getByText("Policy violation: weapons.")).toBeInTheDocument();

    rerender(
      <DescribeItDialog
        {...BASE_PROPS}
        request={makeRequest({ status: "failed", errorMessage: "The image generation service returned no usable images." })}
      />,
    );
    expect(screen.getByText("Generation failed")).toBeInTheDocument();
  });

  it("terminal-error: Try again calls onStartOver", async () => {
    const onStartOver = vi.fn();
    render(<DescribeItDialog {...BASE_PROPS} request={makeRequest({ status: "failed", errorMessage: "boom" })} onStartOver={onStartOver} />);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onStartOver).toHaveBeenCalled();
  });

  it("ready: picking a variation, naming it, and saving calls onSelect and shows success", async () => {
    const onSelect = vi.fn().mockResolvedValue({ assetId: "a1", originalName: "moss-tile.png" });
    const request = makeRequest({ status: "ready", variations: [{ id: "v1", width: 32, height: 32, selected: false }] });
    render(<DescribeItDialog {...BASE_PROPS} request={request} onSelect={onSelect} />);

    await userEvent.click(screen.getByRole("button", { name: /Use variation 32×32/ }));
    await userEvent.type(screen.getByLabelText("Asset name"), "moss-tile.png");
    await userEvent.click(screen.getByRole("button", { name: "Save as asset" }));

    expect(onSelect).toHaveBeenCalledWith("v1", "moss-tile.png");
    expect(await screen.findByText("Saved as an asset")).toBeInTheDocument();
    expect(screen.getByText("moss-tile.png")).toBeInTheDocument();
  });

  it("ready: Save as asset stays disabled until a name is entered", async () => {
    const request = makeRequest({ status: "ready", variations: [{ id: "v1", width: 16, height: 16, selected: false }] });
    render(<DescribeItDialog {...BASE_PROPS} request={request} />);

    await userEvent.click(screen.getByRole("button", { name: /Use variation 16×16/ }));
    expect(screen.getByRole("button", { name: "Save as asset" })).toBeDisabled();
  });
});
