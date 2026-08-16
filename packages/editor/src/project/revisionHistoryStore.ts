import type { ViewState } from "@forge/ds";
import { create } from "zustand";
import { ApiError, NetworkError } from "../api/httpClient";
import { listRevisions, type RevisionSummary } from "../api/projectsApi";

interface RevisionHistoryState {
  readonly projectId: string | undefined;
  readonly status: ViewState;
  readonly revisions: readonly RevisionSummary[];
  readonly error: string | undefined;
  readonly nextCursor: number | undefined;
  readonly loadingMore: boolean;
  load: (projectId: string) => Promise<void>;
  loadMore: () => Promise<void>;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function toErrorState(error: unknown): Pick<RevisionHistoryState, "status" | "error"> {
  if (error instanceof NetworkError) return { status: "offline", error: error.message };
  // Cross-tenant/unauthorized access returns 404, never 403 (CLAUDE.md
  // Section 4.5) — a 404 here means read access to a project the editor
  // already has open was denied or revoked, not that the project vanished.
  if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
    return { status: "permission-denied", error: error.message };
  }
  return { status: "error", error: error instanceof Error ? error.message : "Could not load revision history." };
}

/**
 * The revision-history list for whichever project is open — separate from
 * `projectSyncStore` (which owns the *current* head/document) because this
 * is a paginated, independently-loading view onto the same project's past,
 * not part of the save/open lifecycle.
 */
export const useRevisionHistoryStore = create<RevisionHistoryState>()((set, get) => ({
  projectId: undefined,
  status: "loading",
  revisions: [],
  error: undefined,
  nextCursor: undefined,
  loadingMore: false,

  load: async (projectId) => {
    if (isOffline()) {
      set({ status: "offline", projectId });
      return;
    }
    set({ status: "loading", error: undefined, projectId, revisions: [], nextCursor: undefined });
    try {
      const page = await listRevisions(projectId);
      set({ status: page.revisions.length === 0 ? "empty" : "populated", revisions: page.revisions, nextCursor: page.nextCursor });
    } catch (error) {
      set(toErrorState(error));
    }
  },

  loadMore: async () => {
    const { projectId, nextCursor, loadingMore } = get();
    if (!projectId || nextCursor === undefined || loadingMore) return;
    set({ loadingMore: true });
    try {
      const page = await listRevisions(projectId, nextCursor);
      set((state) => ({
        revisions: [...state.revisions, ...page.revisions],
        nextCursor: page.nextCursor,
        loadingMore: false,
      }));
    } catch {
      // "Load more" failing leaves the already-loaded page visible rather
      // than blowing away the list into a full error state — the person
      // can retry by scrolling/clicking again.
      set({ loadingMore: false });
    }
  },
}));
