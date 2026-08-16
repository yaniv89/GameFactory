import { create } from "zustand";
import { ApiError, NetworkError } from "../api/httpClient";
import { commitRevision, getProjectDocument, type ProjectDocumentEnvelope } from "../api/projectsApi";
import { migrateDocument, useProjectStore, type ProjectDocument } from "../store/projectStore";

export type SyncStatus = "idle" | "opening" | "saving" | "saved" | "conflict" | "error" | "offline";

interface ProjectSyncState {
  readonly projectId: string | undefined;
  readonly projectTitle: string | undefined;
  readonly headRevision: number | undefined;
  readonly status: SyncStatus;
  readonly error: string | undefined;
  /** Set only on a 409 — the server's real current revision, so a retry can show the person what actually changed rather than guessing. */
  readonly conflictActualRevision: number | undefined;
  openProject: (projectId: string, projectTitle: string) => Promise<void>;
  saveProject: (label?: string) => Promise<void>;
  closeProject: () => void;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export const useProjectSyncStore = create<ProjectSyncState>()((set, get) => ({
  projectId: undefined,
  projectTitle: undefined,
  headRevision: undefined,
  status: "idle",
  error: undefined,
  conflictActualRevision: undefined,

  openProject: async (projectId, projectTitle) => {
    if (isOffline()) {
      set({ status: "offline", projectId, projectTitle });
      return;
    }
    set({ status: "opening", error: undefined, conflictActualRevision: undefined, projectId, projectTitle });
    try {
      const envelope: ProjectDocumentEnvelope | undefined = await getProjectDocument(projectId);
      // No revisions yet (a project is created empty) — start from a
      // blank document rather than treating "nothing to load" as a
      // failure; the first `saveProject()` call is what creates revision 1.
      const document = migrateDocument(envelope?.document as Partial<ProjectDocument> | undefined);
      useProjectStore.getState().loadDocument(document);
      set({ status: "idle", headRevision: envelope?.revisionId });
    } catch (error) {
      set(toErrorState(error));
    }
  },

  saveProject: async (label) => {
    const { projectId, headRevision } = get();
    if (!projectId) return;
    if (isOffline()) {
      set({ status: "offline" });
      return;
    }
    set({ status: "saving", error: undefined, conflictActualRevision: undefined });
    try {
      const document = useProjectStore.getState().document;
      const result = await commitRevision(projectId, {
        expectedHeadRevision: headRevision,
        label: label ?? undefined,
        isCheckpoint: false,
        document,
      });
      set({ status: "saved", headRevision: result.revisionId });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        set({
          status: "conflict",
          error: error.message,
          conflictActualRevision: error.extensions?.actualHeadRevision as number | undefined,
        });
        return;
      }
      set(toErrorState(error));
    }
  },

  closeProject: () =>
    set({ projectId: undefined, projectTitle: undefined, headRevision: undefined, status: "idle", error: undefined, conflictActualRevision: undefined }),
}));

function toErrorState(error: unknown): Pick<ProjectSyncState, "status" | "error"> {
  if (error instanceof NetworkError) return { status: "offline", error: error.message };
  return { status: "error", error: error instanceof Error ? error.message : "Something went wrong." };
}
