import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../api/httpClient";
import * as projectsApi from "../api/projectsApi";
import { useProjectStore } from "../store/projectStore";
import { useProjectSyncStore } from "./projectSyncStore";

vi.mock("../api/projectsApi", () => ({
  getProjectDocument: vi.fn(),
  commitRevision: vi.fn(),
}));

const DOCUMENT = { scenes: [{ id: "s1", name: "village", entities: [], tiles: [] }], installedModules: {}, activePack: undefined, packOverrides: {}, packTerrainRemap: {} };

describe("useProjectSyncStore", () => {
  beforeEach(() => {
    vi.mocked(projectsApi.getProjectDocument).mockReset();
    vi.mocked(projectsApi.commitRevision).mockReset();
    useProjectSyncStore.setState({
      projectId: undefined,
      projectTitle: undefined,
      headRevision: undefined,
      status: "idle",
      error: undefined,
      conflictActualRevision: undefined,
    });
    useProjectStore.getState().loadDocument({ scenes: [], installedModules: {}, activePack: undefined, packOverrides: {}, packTerrainRemap: {} });
    Object.defineProperty(window.navigator, "onLine", { value: true, writable: true, configurable: true });
  });

  it("openProject loads a brand-new project (no revisions yet) as a blank document", async () => {
    vi.mocked(projectsApi.getProjectDocument).mockResolvedValueOnce(undefined);

    await useProjectSyncStore.getState().openProject("p1", "Starter RPG");

    expect(useProjectSyncStore.getState().status).toBe("idle");
    expect(useProjectSyncStore.getState().headRevision).toBeUndefined();
    expect(useProjectStore.getState().document.scenes).toEqual([]);
  });

  it("openProject loads an existing document and its revision id, resetting undo history", async () => {
    vi.mocked(projectsApi.getProjectDocument).mockResolvedValueOnce({
      revisionId: 7,
      parentId: 6,
      label: undefined,
      document: DOCUMENT,
      createdAt: "2026-08-10T00:00:00Z",
    });
    useProjectStore.setState({
      past: [{ forward: { type: "scene/create", sceneId: "x", name: "x" }, inverse: { type: "scene/delete", sceneId: "x", name: "x" } }],
    });

    await useProjectSyncStore.getState().openProject("p1", "Starter RPG");

    expect(useProjectSyncStore.getState().headRevision).toBe(7);
    expect(useProjectStore.getState().document.scenes[0]?.id).toBe("s1");
    expect(useProjectStore.getState().past).toEqual([]);
  });

  it("openProject lands on offline without a network call when the browser is offline", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, writable: true, configurable: true });

    await useProjectSyncStore.getState().openProject("p1", "Starter RPG");

    expect(useProjectSyncStore.getState().status).toBe("offline");
    expect(projectsApi.getProjectDocument).not.toHaveBeenCalled();
  });

  it("saveProject commits the live document with the held headRevision and stores the new one", async () => {
    vi.mocked(projectsApi.getProjectDocument).mockResolvedValueOnce(undefined);
    vi.mocked(projectsApi.commitRevision).mockResolvedValueOnce({ revisionId: 1, docHash: "abc", createdAt: "2026-08-16T00:00:00Z" });
    await useProjectSyncStore.getState().openProject("p1", "Starter RPG");

    await useProjectSyncStore.getState().saveProject();

    expect(useProjectSyncStore.getState().status).toBe("saved");
    expect(useProjectSyncStore.getState().headRevision).toBe(1);
    expect(projectsApi.commitRevision).toHaveBeenCalledWith("p1", expect.objectContaining({ expectedHeadRevision: undefined }));
  });

  it("saveProject surfaces a 409 as a conflict without clobbering the local document", async () => {
    vi.mocked(projectsApi.getProjectDocument).mockResolvedValueOnce(undefined);
    vi.mocked(projectsApi.commitRevision).mockRejectedValueOnce(
      new ApiError("Revision conflict", 409, { actualHeadRevision: 5 }),
    );
    await useProjectSyncStore.getState().openProject("p1", "Starter RPG");
    const documentBefore = useProjectStore.getState().document;

    await useProjectSyncStore.getState().saveProject();

    expect(useProjectSyncStore.getState().status).toBe("conflict");
    expect(useProjectSyncStore.getState().conflictActualRevision).toBe(5);
    expect(useProjectStore.getState().document).toBe(documentBefore);
  });

  it("saveProject surfaces a network failure as offline", async () => {
    vi.mocked(projectsApi.getProjectDocument).mockResolvedValueOnce(undefined);
    vi.mocked(projectsApi.commitRevision).mockRejectedValueOnce(new NetworkError(new Error("boom")));
    await useProjectSyncStore.getState().openProject("p1", "Starter RPG");

    await useProjectSyncStore.getState().saveProject();

    expect(useProjectSyncStore.getState().status).toBe("offline");
  });

  it("closeProject clears the held project id and revision", async () => {
    vi.mocked(projectsApi.getProjectDocument).mockResolvedValueOnce(undefined);
    await useProjectSyncStore.getState().openProject("p1", "Starter RPG");

    useProjectSyncStore.getState().closeProject();

    expect(useProjectSyncStore.getState().projectId).toBeUndefined();
    expect(useProjectSyncStore.getState().status).toBe("idle");
  });
});
