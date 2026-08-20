import type { ViewState } from "@forge/ds";
import { create } from "zustand";
import { deleteAsset, listAssets, uploadAsset, type AssetSummary } from "../api/assetsApi";
import { ApiError, NetworkError } from "../api/httpClient";

interface AssetsState {
  readonly status: ViewState;
  readonly assets: readonly AssetSummary[];
  readonly error: string | undefined;
  readonly uploading: boolean;
  readonly uploadError: string | undefined;
  load: (workspaceId: string) => Promise<void>;
  upload: (workspaceId: string, path: string, file: File) => Promise<void>;
  remove: (assetId: string) => Promise<void>;
  clearUploadError: () => void;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function toErrorState(error: unknown): Pick<AssetsState, "status" | "error"> {
  if (error instanceof NetworkError) return { status: "offline", error: error.message };
  // Cross-tenant/unauthorized access returns 404, never 403 (CLAUDE.md
  // Section 4.5) — same convention projectsStore.ts's own toErrorState
  // already follows for the identical reason.
  if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
    return { status: "permission-denied", error: error.message };
  }
  return { status: "error", error: error instanceof Error ? error.message : "Could not load this workspace's assets." };
}

/**
 * The editor's own asset library (docs/adr/0012 E4): list/upload/delete
 * against a workspace's `Asset` rows. `AssetsLibraryDialog` is the only
 * consumer today — reusing `projectsStore.ts`'s own status-machine shape
 * rather than inventing a second one.
 */
export const useAssetsStore = create<AssetsState>()((set, get) => ({
  status: "loading",
  assets: [],
  error: undefined,
  uploading: false,
  uploadError: undefined,

  load: async (workspaceId) => {
    if (isOffline()) {
      set({ status: "offline" });
      return;
    }
    set({ status: "loading", error: undefined });
    try {
      const { assets } = await listAssets(workspaceId);
      set({ status: assets.length === 0 ? "empty" : "populated", assets });
    } catch (error) {
      set(toErrorState(error));
    }
  },

  upload: async (workspaceId, path, file) => {
    set({ uploading: true, uploadError: undefined });
    try {
      await uploadAsset(workspaceId, path, file.type || "application/octet-stream", file);
      // A fresh list, not a locally-appended optimistic row: upload
      // returns only {id, status, createdAt} (UploadAssetResponse.cs), and
      // a same-hash re-upload dedupes onto an existing row server-side
      // (docs/adr/0012 Decision 3 step 4) — re-fetching is the only way
      // this view stays correct in that case rather than showing a
      // duplicate.
      await get().load(workspaceId);
    } catch (error) {
      set({ uploadError: error instanceof Error ? error.message : "Could not upload this file." });
    } finally {
      set({ uploading: false });
    }
  },

  remove: async (assetId) => {
    const previous = get().assets;
    // Optimistic removal — DELETE has nothing left to conflict with
    // (guardrail 5.3: "local edits apply before any round trip"), rolled
    // back on failure rather than left silently wrong.
    set((state) => ({ assets: state.assets.filter((asset) => asset.id !== assetId) }));
    try {
      await deleteAsset(assetId);
    } catch (error) {
      set({ assets: previous, uploadError: error instanceof Error ? error.message : "Could not delete this asset." });
    }
  },

  clearUploadError: () => set({ uploadError: undefined }),
}));
