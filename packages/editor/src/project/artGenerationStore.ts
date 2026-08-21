import type { ViewState } from "@forge/ds";
import { create } from "zustand";
import {
  confirmGenerationRequest,
  createGenerationRequest,
  getGenerationRequest,
  selectGenerationVariation,
  type ArtGenCategory,
  type GenerationRequestResult,
  type SelectVariationResult,
} from "../api/artGenerationApi";
import { ApiError, NetworkError } from "../api/httpClient";

// docs/adr/0016: generous enough that a creator sees near-live progress
// without the poll itself competing for the same RateLimitPolicies.Api
// budget (300/min) real editing traffic uses — one request every 2s is
// well under that even alongside normal use.
const POLL_INTERVAL_MS = 2000;

const TERMINAL_STATUSES: ReadonlySet<GenerationRequestResult["status"]> = new Set(["ready", "failed", "declined"]);

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function toPollErrorState(error: unknown): Pick<ArtGenerationState, "pollState" | "pollError"> {
  if (error instanceof NetworkError) return { pollState: "offline", pollError: error.message };
  // Cross-tenant/unauthorized access returns 404, never 403 (CLAUDE.md
  // Section 4.5) — same convention every other store in this package
  // follows.
  if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
    return { pollState: "permission-denied", pollError: error.message };
  }
  return { pollState: "error", pollError: error instanceof Error ? error.message : "Could not check on this generation." };
}

interface ArtGenerationState {
  readonly submitting: boolean;
  readonly submitError: string | undefined;
  /** From a 429's own `Retry-After` (CLAUDE.md 4.8) — surfaced so the compose form can say when to try again instead of just "try again." */
  readonly retryAfterSeconds: number | undefined;

  /** The live request, once `create` has succeeded at least once. */
  readonly request: GenerationRequestResult | undefined;

  /**
   * The poll fetch's own six-state lifecycle (CLAUDE.md 5.4) — distinct
   * from `request.status` (the domain's own awaiting_confirmation/queued/
   * generating/ready/failed/declined machine, rendered *within* the
   * "populated" state once a real response has come back, the same way
   * `AssetSummary.status` renders inside `AssetsLibraryDialog`'s own
   * Panel "populated" state rather than as a distinct Panel state).
   */
  readonly pollState: ViewState;
  readonly pollError: string | undefined;

  readonly confirming: boolean;
  readonly confirmError: string | undefined;

  readonly selecting: boolean;
  readonly selectError: string | undefined;

  create: (workspaceId: string, projectId: string, userPrompt: string, category: ArtGenCategory) => Promise<void>;
  confirm: (workspaceId: string, projectId: string) => Promise<void>;
  select: (workspaceId: string, projectId: string, variationId: string, assetName: string) => Promise<SelectVariationResult | undefined>;
  /** Stops any in-flight poll and clears every field back to its initial value — called on dialog close so reopening starts a genuinely fresh "describe it" rather than resuming a stale request. */
  reset: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | undefined;

function stopPolling(): void {
  if (pollTimer !== undefined) {
    clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

const initialState = {
  submitting: false,
  submitError: undefined,
  retryAfterSeconds: undefined,
  request: undefined,
  pollState: "loading" as ViewState,
  pollError: undefined,
  confirming: false,
  confirmError: undefined,
  selecting: false,
  selectError: undefined,
};

/**
 * N5: state for the "Describe it" dialog's whole lifecycle — compose,
 * server-side expansion, confirm, poll `Forge.Functions.ArtGen` (N3/N4)
 * to a terminal state, and select a variation into a real Asset
 * (`SelectGenerationVariationEndpoint.cs`, N5). One store, not split
 * per phase, because the phases share one `request` value threaded
 * through all of them — the same reasoning `projectSyncStore.ts` gives
 * for keeping save/load/conflict state together rather than three stores
 * that would all need to agree on the same project id.
 */
export const useArtGenerationStore = create<ArtGenerationState>()((set, get) => ({
  ...initialState,

  create: async (workspaceId, projectId, userPrompt, category) => {
    set({ submitting: true, submitError: undefined, retryAfterSeconds: undefined });
    try {
      const request = await createGenerationRequest(workspaceId, projectId, userPrompt, category);
      set({ request, pollState: "populated" });
    } catch (error) {
      set({
        submitError: error instanceof Error ? error.message : "Could not start this generation.",
        retryAfterSeconds: error instanceof ApiError ? error.retryAfterSeconds : undefined,
      });
    } finally {
      set({ submitting: false });
    }
  },

  confirm: async (workspaceId, projectId) => {
    const { request } = get();
    if (!request) return;
    set({ confirming: true, confirmError: undefined });
    try {
      const confirmed = await confirmGenerationRequest(workspaceId, projectId, request.id);
      set({ request: confirmed, pollState: "loading" });

      stopPolling();
      pollTimer = setInterval(() => {
        if (isOffline()) {
          set({ pollState: "offline" });
          return;
        }
        void getGenerationRequest(workspaceId, projectId, confirmed.id)
          .then((polled) => {
            set({ request: polled, pollState: "populated", pollError: undefined });
            if (TERMINAL_STATUSES.has(polled.status)) stopPolling();
          })
          .catch((error: unknown) => {
            const nextState = toPollErrorState(error);
            set(nextState);
            // permission-denied (a 404/403 mid-poll) means the request or
            // project genuinely isn't there to check on anymore -- unlike
            // "error"/"offline", which are transient and worth the
            // interval's own next automatic tick, retrying this one
            // would never succeed.
            if (nextState.pollState === "permission-denied") stopPolling();
          });
      }, POLL_INTERVAL_MS);
    } catch (error) {
      set({ confirmError: error instanceof Error ? error.message : "Could not confirm this generation." });
    } finally {
      set({ confirming: false });
    }
  },

  select: async (workspaceId, projectId, variationId, assetName) => {
    const { request } = get();
    if (!request) return undefined;
    set({ selecting: true, selectError: undefined });
    try {
      const result = await selectGenerationVariation(workspaceId, projectId, request.id, variationId, assetName);
      // A fresh fetch, not a locally-flipped `selected` flag -- the same
      // "re-fetch is the only way this view stays correct" reasoning
      // assetsStore.ts's own `upload` gives, here for the same-bytes
      // dedupe case (SelectGenerationVariationEndpoint.cs's own doc
      // comment) where the server's own account of what got selected can
      // differ from a naive client-side guess.
      const refreshed = await getGenerationRequest(workspaceId, projectId, request.id);
      set({ request: refreshed });
      return result;
    } catch (error) {
      set({ selectError: error instanceof Error ? error.message : "Could not save this variation as an asset." });
      return undefined;
    } finally {
      set({ selecting: false });
    }
  },

  reset: () => {
    stopPolling();
    set(initialState);
  },
}));
