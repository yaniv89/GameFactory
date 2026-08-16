import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "../api/httpClient";
import * as projectsApi from "../api/projectsApi";
import { useRevisionHistoryStore } from "./revisionHistoryStore";

vi.mock("../api/projectsApi", () => ({
  listRevisions: vi.fn(),
}));

const REVISION_A = { id: 3, parentId: 2, authorId: "u1", label: "Added the cave", sizeBytes: 512, isCheckpoint: false, createdAt: "2026-08-16T00:00:00Z" };
const REVISION_B = { id: 2, parentId: 1, authorId: "u1", label: undefined, sizeBytes: 480, isCheckpoint: true, createdAt: "2026-08-15T00:00:00Z" };

describe("useRevisionHistoryStore", () => {
  beforeEach(() => {
    vi.mocked(projectsApi.listRevisions).mockReset();
    useRevisionHistoryStore.setState({
      projectId: undefined,
      status: "loading",
      revisions: [],
      error: undefined,
      nextCursor: undefined,
      loadingMore: false,
    });
    Object.defineProperty(window.navigator, "onLine", { value: true, writable: true, configurable: true });
  });

  it("load populates the list and clears any earlier project's revisions first", async () => {
    vi.mocked(projectsApi.listRevisions).mockResolvedValueOnce({ revisions: [REVISION_A, REVISION_B], nextCursor: undefined });

    await useRevisionHistoryStore.getState().load("p1");

    expect(useRevisionHistoryStore.getState().status).toBe("populated");
    expect(useRevisionHistoryStore.getState().revisions).toEqual([REVISION_A, REVISION_B]);
    expect(projectsApi.listRevisions).toHaveBeenCalledWith("p1");
  });

  it("load lands on empty when the project has no revisions yet", async () => {
    vi.mocked(projectsApi.listRevisions).mockResolvedValueOnce({ revisions: [], nextCursor: undefined });

    await useRevisionHistoryStore.getState().load("p1");

    expect(useRevisionHistoryStore.getState().status).toBe("empty");
  });

  it("load lands on offline without a network call when the browser is offline", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, writable: true, configurable: true });

    await useRevisionHistoryStore.getState().load("p1");

    expect(useRevisionHistoryStore.getState().status).toBe("offline");
    expect(projectsApi.listRevisions).not.toHaveBeenCalled();
  });

  it("load treats a 404/403 as permission-denied (cross-tenant access never returns a distinguishable 403, CLAUDE.md 4.5)", async () => {
    vi.mocked(projectsApi.listRevisions).mockRejectedValueOnce(new ApiError("Not Found", 404, undefined));

    await useRevisionHistoryStore.getState().load("p1");

    expect(useRevisionHistoryStore.getState().status).toBe("permission-denied");
  });

  it("load surfaces any other failure as a plain error", async () => {
    vi.mocked(projectsApi.listRevisions).mockRejectedValueOnce(new ApiError("Something broke", 500, undefined));

    await useRevisionHistoryStore.getState().load("p1");

    expect(useRevisionHistoryStore.getState().status).toBe("error");
    expect(useRevisionHistoryStore.getState().error).toBe("Something broke");
  });

  it("load surfaces a network failure as offline too", async () => {
    vi.mocked(projectsApi.listRevisions).mockRejectedValueOnce(new NetworkError(new Error("boom")));

    await useRevisionHistoryStore.getState().load("p1");

    expect(useRevisionHistoryStore.getState().status).toBe("offline");
  });

  it("loadMore appends the next page using the held cursor and updates it", async () => {
    vi.mocked(projectsApi.listRevisions).mockResolvedValueOnce({ revisions: [REVISION_A], nextCursor: 2 });
    await useRevisionHistoryStore.getState().load("p1");
    vi.mocked(projectsApi.listRevisions).mockResolvedValueOnce({ revisions: [REVISION_B], nextCursor: undefined });

    await useRevisionHistoryStore.getState().loadMore();

    expect(projectsApi.listRevisions).toHaveBeenLastCalledWith("p1", 2);
    expect(useRevisionHistoryStore.getState().revisions).toEqual([REVISION_A, REVISION_B]);
    expect(useRevisionHistoryStore.getState().nextCursor).toBeUndefined();
  });

  it("loadMore is a no-op once there's no next cursor", async () => {
    vi.mocked(projectsApi.listRevisions).mockResolvedValueOnce({ revisions: [REVISION_A], nextCursor: undefined });
    await useRevisionHistoryStore.getState().load("p1");

    await useRevisionHistoryStore.getState().loadMore();

    expect(projectsApi.listRevisions).toHaveBeenCalledTimes(1);
  });

  it("loadMore leaves the already-loaded page visible if the next page fails", async () => {
    vi.mocked(projectsApi.listRevisions).mockResolvedValueOnce({ revisions: [REVISION_A], nextCursor: 2 });
    await useRevisionHistoryStore.getState().load("p1");
    vi.mocked(projectsApi.listRevisions).mockRejectedValueOnce(new Error("boom"));

    await useRevisionHistoryStore.getState().loadMore();

    expect(useRevisionHistoryStore.getState().revisions).toEqual([REVISION_A]);
    expect(useRevisionHistoryStore.getState().status).toBe("populated");
    expect(useRevisionHistoryStore.getState().loadingMore).toBe(false);
  });
});
