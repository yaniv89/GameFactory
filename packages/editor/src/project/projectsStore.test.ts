import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../api/httpClient";
import * as projectsApi from "../api/projectsApi";
import type { MeResponse, ProjectSummary } from "../api/projectsApi";
import { useProjectsStore } from "./projectsStore";

vi.mock("../api/projectsApi", () => ({
  getMe: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
}));

const WORKSPACE = { workspaceId: "ws1", slug: "ada", name: "Ada's Workspace", plan: "free", role: "owner" };
const ME: MeResponse = { userId: "u1", email: "ada@example.com", displayName: "Ada", emailVerifiedAt: undefined, workspaces: [WORKSPACE] };
const PROJECT: ProjectSummary = {
  id: "p1",
  workspaceId: "ws1",
  slug: "starter-rpg",
  title: "Starter RPG",
  visibility: "private",
  headRevision: undefined,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

describe("useProjectsStore", () => {
  beforeEach(() => {
    vi.mocked(projectsApi.getMe).mockReset();
    vi.mocked(projectsApi.listProjects).mockReset();
    vi.mocked(projectsApi.createProject).mockReset();
    useProjectsStore.setState({ status: "loading", workspace: undefined, projects: [], error: undefined, creating: false, createError: undefined });
    Object.defineProperty(window.navigator, "onLine", { value: true, writable: true, configurable: true });
  });

  it("loads the first workspace and its projects, landing on populated when there are some", async () => {
    vi.mocked(projectsApi.getMe).mockResolvedValueOnce(ME);
    vi.mocked(projectsApi.listProjects).mockResolvedValueOnce([PROJECT]);

    await useProjectsStore.getState().load();

    expect(useProjectsStore.getState().status).toBe("populated");
    expect(useProjectsStore.getState().workspace).toEqual(WORKSPACE);
    expect(useProjectsStore.getState().projects).toEqual([PROJECT]);
    expect(projectsApi.listProjects).toHaveBeenCalledWith("ws1");
  });

  it("lands on empty when the workspace has no projects", async () => {
    vi.mocked(projectsApi.getMe).mockResolvedValueOnce(ME);
    vi.mocked(projectsApi.listProjects).mockResolvedValueOnce([]);

    await useProjectsStore.getState().load();

    expect(useProjectsStore.getState().status).toBe("empty");
  });

  it("treats a 404 on the projects list as permission-denied, not a generic error (cross-tenant parity)", async () => {
    vi.mocked(projectsApi.getMe).mockResolvedValueOnce(ME);
    vi.mocked(projectsApi.listProjects).mockRejectedValueOnce(new ApiError("Not found", 404, undefined));

    await useProjectsStore.getState().load();

    expect(useProjectsStore.getState().status).toBe("permission-denied");
  });

  it("lands on offline without calling the network when navigator.onLine is false", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, writable: true, configurable: true });

    await useProjectsStore.getState().load();

    expect(useProjectsStore.getState().status).toBe("offline");
    expect(projectsApi.getMe).not.toHaveBeenCalled();
  });

  it("surfaces a network failure as offline", async () => {
    vi.mocked(projectsApi.getMe).mockRejectedValueOnce(new NetworkError(new Error("boom")));

    await useProjectsStore.getState().load();

    expect(useProjectsStore.getState().status).toBe("offline");
  });

  it("create() posts to the loaded workspace and prepends the new project", async () => {
    vi.mocked(projectsApi.getMe).mockResolvedValueOnce(ME);
    vi.mocked(projectsApi.listProjects).mockResolvedValueOnce([]);
    vi.mocked(projectsApi.createProject).mockResolvedValueOnce(PROJECT);
    await useProjectsStore.getState().load();

    const created = await useProjectsStore.getState().create({ title: "Starter RPG", slug: "starter-rpg" });

    expect(created).toEqual(PROJECT);
    expect(useProjectsStore.getState().projects).toEqual([PROJECT]);
    expect(useProjectsStore.getState().status).toBe("populated");
    expect(projectsApi.createProject).toHaveBeenCalledWith("ws1", expect.objectContaining({ title: "Starter RPG", slug: "starter-rpg" }));
  });

  it("create() surfaces a server validation error without touching the project list", async () => {
    vi.mocked(projectsApi.getMe).mockResolvedValueOnce(ME);
    vi.mocked(projectsApi.listProjects).mockResolvedValueOnce([]);
    vi.mocked(projectsApi.createProject).mockRejectedValueOnce(new ApiError("Slug already in use.", 409, undefined));
    await useProjectsStore.getState().load();

    const created = await useProjectsStore.getState().create({ title: "Starter RPG", slug: "starter-rpg" });

    expect(created).toBeUndefined();
    expect(useProjectsStore.getState().createError).toBe("Slug already in use.");
    expect(useProjectsStore.getState().projects).toEqual([]);
  });
});
