import type { ViewState } from "@forge/ds";
import { create } from "zustand";
import { ApiError, NetworkError } from "../api/httpClient";
import { createProject, getMe, listProjects, type CreateProjectInput, type ProjectSummary, type WorkspaceSummary } from "../api/projectsApi";

interface ProjectsState {
  readonly status: ViewState;
  readonly workspace: WorkspaceSummary | undefined;
  readonly projects: readonly ProjectSummary[];
  readonly error: string | undefined;
  readonly creating: boolean;
  readonly createError: string | undefined;
  load: () => Promise<void>;
  create: (input: Omit<CreateProjectInput, "genreTemplate" | "engineVersion"> & Partial<Pick<CreateProjectInput, "genreTemplate" | "engineVersion">>) => Promise<ProjectSummary | undefined>;
  clearCreateError: () => void;
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * There is no workspace-switcher UI yet (a stated gap — every account
 * today has exactly one workspace, created at signup by `SignupEndpoint`,
 * so "the first one `/api/v1/me` reports" is a correct, not just
 * convenient, choice until multi-workspace membership is a real feature).
 */
function pickWorkspace(workspaces: readonly WorkspaceSummary[]): WorkspaceSummary | undefined {
  return workspaces[0];
}

export const useProjectsStore = create<ProjectsState>()((set, get) => ({
  status: "loading",
  workspace: undefined,
  projects: [],
  error: undefined,
  creating: false,
  createError: undefined,

  load: async () => {
    if (isOffline()) {
      set({ status: "offline" });
      return;
    }
    set({ status: "loading", error: undefined });
    try {
      const me = await getMe();
      const workspace = pickWorkspace(me.workspaces);
      if (!workspace) {
        // Contradicts SignupEndpoint's own invariant ("a brand-new account
        // is never workspace-less") — surfaced as an error rather than
        // silently rendering an empty list that looks like "no projects yet".
        set({ status: "error", error: "Your account has no workspace. Contact support." });
        return;
      }
      const projects = await listProjects(workspace.workspaceId);
      set({ status: projects.length === 0 ? "empty" : "populated", workspace, projects });
    } catch (error) {
      set(toErrorState(error));
    }
  },

  create: async (input) => {
    const workspace = get().workspace;
    if (!workspace) return undefined;
    set({ creating: true, createError: undefined });
    try {
      const project = await createProject(workspace.workspaceId, {
        engineVersion: "0.1.0",
        ...input,
      });
      set((state) => ({ creating: false, status: "populated", projects: [project, ...state.projects] }));
      return project;
    } catch (error) {
      set({ creating: false, createError: error instanceof Error ? error.message : "Could not create the project." });
      return undefined;
    }
  },

  clearCreateError: () => set({ createError: undefined }),
}));

function toErrorState(error: unknown): Pick<ProjectsState, "status" | "error"> {
  if (error instanceof NetworkError) return { status: "offline", error: error.message };
  // Cross-tenant/unauthorized access returns 404, never 403 (CLAUDE.md
  // Section 4.5) — a 404 on "my own workspace's projects" therefore means
  // permission was denied server-side, not that the workspace is missing.
  if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
    return { status: "permission-denied", error: error.message };
  }
  return { status: "error", error: error instanceof Error ? error.message : "Could not load your projects." };
}
