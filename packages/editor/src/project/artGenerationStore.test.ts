import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationRequestResult } from "../api/artGenerationApi";
import * as artGenerationApi from "../api/artGenerationApi";
import { ApiError, NetworkError } from "../api/httpClient";
import { useArtGenerationStore } from "./artGenerationStore";

vi.mock("../api/artGenerationApi", () => ({
  createGenerationRequest: vi.fn(),
  confirmGenerationRequest: vi.fn(),
  getGenerationRequest: vi.fn(),
  selectGenerationVariation: vi.fn(),
}));

const WORKSPACE_ID = "ws1";
const PROJECT_ID = "p1";

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

describe("useArtGenerationStore", () => {
  beforeEach(() => {
    vi.mocked(artGenerationApi.createGenerationRequest).mockReset();
    vi.mocked(artGenerationApi.confirmGenerationRequest).mockReset();
    vi.mocked(artGenerationApi.getGenerationRequest).mockReset();
    vi.mocked(artGenerationApi.selectGenerationVariation).mockReset();
    useArtGenerationStore.getState().reset();
    Object.defineProperty(window.navigator, "onLine", { value: true, writable: true, configurable: true });
  });

  afterEach(() => {
    useArtGenerationStore.getState().reset();
    vi.useRealTimers();
  });

  it("create() succeeds into awaiting_confirmation", async () => {
    const request = makeRequest();
    vi.mocked(artGenerationApi.createGenerationRequest).mockResolvedValueOnce(request);

    await useArtGenerationStore.getState().create(WORKSPACE_ID, PROJECT_ID, "a mossy stone tile", "tile");

    expect(artGenerationApi.createGenerationRequest).toHaveBeenCalledWith(WORKSPACE_ID, PROJECT_ID, "a mossy stone tile", "tile");
    expect(useArtGenerationStore.getState().request).toEqual(request);
    expect(useArtGenerationStore.getState().submitting).toBe(false);
  });

  it("create() surfaces a 402 message with no retryAfterSeconds", async () => {
    vi.mocked(artGenerationApi.createGenerationRequest).mockRejectedValueOnce(
      new ApiError("This action requires a Pro or Studio plan. Upgrade your workspace to continue.", 402, undefined),
    );

    await useArtGenerationStore.getState().create(WORKSPACE_ID, PROJECT_ID, "a mossy stone tile", "tile");

    expect(useArtGenerationStore.getState().submitError).toBe("This action requires a Pro or Studio plan. Upgrade your workspace to continue.");
    expect(useArtGenerationStore.getState().retryAfterSeconds).toBeUndefined();
    expect(useArtGenerationStore.getState().request).toBeUndefined();
  });

  it("create() surfaces a 429's retryAfterSeconds", async () => {
    vi.mocked(artGenerationApi.createGenerationRequest).mockRejectedValueOnce(new ApiError("Too many requests.", 429, undefined, 42));

    await useArtGenerationStore.getState().create(WORKSPACE_ID, PROJECT_ID, "a mossy stone tile", "tile");

    expect(useArtGenerationStore.getState().retryAfterSeconds).toBe(42);
  });

  it("confirm() moves to queued and starts polling until a terminal status", async () => {
    vi.useFakeTimers();
    useArtGenerationStore.setState({ request: makeRequest() });
    vi.mocked(artGenerationApi.confirmGenerationRequest).mockResolvedValueOnce(makeRequest({ status: "queued" }));
    vi.mocked(artGenerationApi.getGenerationRequest)
      .mockResolvedValueOnce(makeRequest({ status: "generating" }))
      .mockResolvedValueOnce(makeRequest({ status: "ready", variations: [{ id: "v1", width: 32, height: 32, selected: false }] }));

    await useArtGenerationStore.getState().confirm(WORKSPACE_ID, PROJECT_ID);
    expect(useArtGenerationStore.getState().request?.status).toBe("queued");

    await vi.advanceTimersByTimeAsync(2000);
    expect(useArtGenerationStore.getState().request?.status).toBe("generating");
    expect(artGenerationApi.getGenerationRequest).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(useArtGenerationStore.getState().request?.status).toBe("ready");

    // Polling stopped on reaching Ready -- a third tick makes no further call.
    await vi.advanceTimersByTimeAsync(4000);
    expect(artGenerationApi.getGenerationRequest).toHaveBeenCalledTimes(2);
  });

  it("a poll network failure lands on offline and keeps retrying automatically", async () => {
    vi.useFakeTimers();
    useArtGenerationStore.setState({ request: makeRequest() });
    vi.mocked(artGenerationApi.confirmGenerationRequest).mockResolvedValueOnce(makeRequest({ status: "queued" }));
    vi.mocked(artGenerationApi.getGenerationRequest)
      .mockRejectedValueOnce(new NetworkError(new Error("boom")))
      .mockResolvedValueOnce(makeRequest({ status: "ready", variations: [] }));

    await useArtGenerationStore.getState().confirm(WORKSPACE_ID, PROJECT_ID);
    await vi.advanceTimersByTimeAsync(2000);
    expect(useArtGenerationStore.getState().pollState).toBe("offline");

    // Kept retrying -- the second tick succeeds and reaches Ready.
    await vi.advanceTimersByTimeAsync(2000);
    expect(useArtGenerationStore.getState().pollState).toBe("populated");
    expect(useArtGenerationStore.getState().request?.status).toBe("ready");
  });

  it("a poll 404 lands on permission-denied and stops polling for good", async () => {
    vi.useFakeTimers();
    useArtGenerationStore.setState({ request: makeRequest() });
    vi.mocked(artGenerationApi.confirmGenerationRequest).mockResolvedValueOnce(makeRequest({ status: "queued" }));
    vi.mocked(artGenerationApi.getGenerationRequest).mockRejectedValue(new ApiError("Not found", 404, undefined));

    await useArtGenerationStore.getState().confirm(WORKSPACE_ID, PROJECT_ID);
    await vi.advanceTimersByTimeAsync(2000);
    expect(useArtGenerationStore.getState().pollState).toBe("permission-denied");

    await vi.advanceTimersByTimeAsync(10000);
    // Exactly one call -- polling stopped rather than hammering an
    // endpoint that will never succeed.
    expect(artGenerationApi.getGenerationRequest).toHaveBeenCalledTimes(1);
  });

  it("select() saves then re-fetches the request rather than guessing the new selected flag locally", async () => {
    const ready = makeRequest({ status: "ready", variations: [{ id: "v1", width: 32, height: 32, selected: false }] });
    useArtGenerationStore.setState({ request: ready });
    vi.mocked(artGenerationApi.selectGenerationVariation).mockResolvedValueOnce({ assetId: "a1", originalName: "moss-tile.png" });
    const refreshed = makeRequest({ status: "ready", variations: [{ id: "v1", width: 32, height: 32, selected: true }] });
    vi.mocked(artGenerationApi.getGenerationRequest).mockResolvedValueOnce(refreshed);

    const result = await useArtGenerationStore.getState().select(WORKSPACE_ID, PROJECT_ID, "v1", "moss-tile.png");

    expect(result).toEqual({ assetId: "a1", originalName: "moss-tile.png" });
    expect(useArtGenerationStore.getState().request).toEqual(refreshed);
    expect(useArtGenerationStore.getState().selecting).toBe(false);
  });

  it("select() surfaces a server error and leaves selecting false", async () => {
    useArtGenerationStore.setState({ request: makeRequest({ status: "ready", variations: [] }) });
    vi.mocked(artGenerationApi.selectGenerationVariation).mockRejectedValueOnce(new ApiError("Storage quota exceeded.", 402, undefined));

    const result = await useArtGenerationStore.getState().select(WORKSPACE_ID, PROJECT_ID, "v1", "moss-tile.png");

    expect(result).toBeUndefined();
    expect(useArtGenerationStore.getState().selectError).toBe("Storage quota exceeded.");
    expect(useArtGenerationStore.getState().selecting).toBe(false);
  });

  it("reset() stops an in-flight poll and clears every field", async () => {
    vi.useFakeTimers();
    useArtGenerationStore.setState({ request: makeRequest() });
    vi.mocked(artGenerationApi.confirmGenerationRequest).mockResolvedValueOnce(makeRequest({ status: "queued" }));
    vi.mocked(artGenerationApi.getGenerationRequest).mockResolvedValue(makeRequest({ status: "generating" }));
    await useArtGenerationStore.getState().confirm(WORKSPACE_ID, PROJECT_ID);

    useArtGenerationStore.getState().reset();
    await vi.advanceTimersByTimeAsync(10000);

    expect(artGenerationApi.getGenerationRequest).not.toHaveBeenCalled();
    expect(useArtGenerationStore.getState().request).toBeUndefined();
  });
});
