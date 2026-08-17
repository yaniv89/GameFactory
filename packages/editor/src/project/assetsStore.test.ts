import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetSummary } from "../api/assetsApi";
import * as assetsApi from "../api/assetsApi";
import { ApiError, NetworkError } from "../api/httpClient";
import { useAssetsStore } from "./assetsStore";

vi.mock("../api/assetsApi", () => ({
  listAssets: vi.fn(),
  uploadAsset: vi.fn(),
  deleteAsset: vi.fn(),
}));

const WORKSPACE_ID = "ws1";
const ASSET: AssetSummary = {
  id: "a1",
  projectId: undefined,
  originalName: "tilesets/outdoor-base.png",
  status: "ready",
  sizeBytes: 2048,
  width: 32,
  height: 32,
  errorMessage: undefined,
  createdAt: "2026-01-01T00:00:00Z",
  completedAt: "2026-01-01T00:00:05Z",
};

describe("useAssetsStore", () => {
  beforeEach(() => {
    vi.mocked(assetsApi.listAssets).mockReset();
    vi.mocked(assetsApi.uploadAsset).mockReset();
    vi.mocked(assetsApi.deleteAsset).mockReset();
    useAssetsStore.setState({ status: "loading", assets: [], error: undefined, uploading: false, uploadError: undefined });
    Object.defineProperty(window.navigator, "onLine", { value: true, writable: true, configurable: true });
  });

  it("loads a workspace's assets, landing on populated when there are some", async () => {
    vi.mocked(assetsApi.listAssets).mockResolvedValueOnce({ assets: [ASSET] });

    await useAssetsStore.getState().load(WORKSPACE_ID);

    expect(useAssetsStore.getState().status).toBe("populated");
    expect(useAssetsStore.getState().assets).toEqual([ASSET]);
    expect(assetsApi.listAssets).toHaveBeenCalledWith(WORKSPACE_ID);
  });

  it("lands on empty when the workspace has no assets", async () => {
    vi.mocked(assetsApi.listAssets).mockResolvedValueOnce({ assets: [] });

    await useAssetsStore.getState().load(WORKSPACE_ID);

    expect(useAssetsStore.getState().status).toBe("empty");
  });

  it("treats a 404 as permission-denied, not a generic error (cross-tenant parity)", async () => {
    vi.mocked(assetsApi.listAssets).mockRejectedValueOnce(new ApiError("Not found", 404, undefined));

    await useAssetsStore.getState().load(WORKSPACE_ID);

    expect(useAssetsStore.getState().status).toBe("permission-denied");
  });

  it("lands on offline without calling the network when navigator.onLine is false", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: false, writable: true, configurable: true });

    await useAssetsStore.getState().load(WORKSPACE_ID);

    expect(useAssetsStore.getState().status).toBe("offline");
    expect(assetsApi.listAssets).not.toHaveBeenCalled();
  });

  it("surfaces a network failure as offline", async () => {
    vi.mocked(assetsApi.listAssets).mockRejectedValueOnce(new NetworkError(new Error("boom")));

    await useAssetsStore.getState().load(WORKSPACE_ID);

    expect(useAssetsStore.getState().status).toBe("offline");
  });

  it("upload() posts the file then reloads the list from the server rather than appending optimistically", async () => {
    const file = new File(["fake-png-bytes"], "outdoor-base.png", { type: "image/png" });
    vi.mocked(assetsApi.uploadAsset).mockResolvedValueOnce({ id: "a1", status: "pending", createdAt: "2026-01-01T00:00:00Z" });
    vi.mocked(assetsApi.listAssets).mockResolvedValueOnce({ assets: [ASSET] });

    await useAssetsStore.getState().upload(WORKSPACE_ID, "tilesets/outdoor-base.png", file);

    expect(assetsApi.uploadAsset).toHaveBeenCalledWith(WORKSPACE_ID, "tilesets/outdoor-base.png", "image/png", file);
    expect(useAssetsStore.getState().assets).toEqual([ASSET]);
    expect(useAssetsStore.getState().uploading).toBe(false);
  });

  it("upload() surfaces a server error and leaves uploading false", async () => {
    const file = new File(["x"], "bad.png", { type: "image/png" });
    vi.mocked(assetsApi.uploadAsset).mockRejectedValueOnce(new ApiError("'image/svg+xml' is not accepted.", 400, undefined));

    await useAssetsStore.getState().upload(WORKSPACE_ID, "bad.png", file);

    expect(useAssetsStore.getState().uploadError).toBe("'image/svg+xml' is not accepted.");
    expect(useAssetsStore.getState().uploading).toBe(false);
  });

  it("remove() optimistically drops the row, and rolls back on failure", async () => {
    useAssetsStore.setState({ status: "populated", assets: [ASSET] });
    vi.mocked(assetsApi.deleteAsset).mockRejectedValueOnce(new ApiError("Not found", 404, undefined));

    await useAssetsStore.getState().remove("a1");

    // Rolled back — the delete failed, so the row is still here rather
    // than silently missing (CLAUDE.md 5.3: an optimistic removal that
    // fails must not just vanish the row for good).
    expect(useAssetsStore.getState().assets).toEqual([ASSET]);
    expect(useAssetsStore.getState().uploadError).toBe("Not found");
  });

  it("remove() leaves the row gone on success", async () => {
    useAssetsStore.setState({ status: "populated", assets: [ASSET] });
    vi.mocked(assetsApi.deleteAsset).mockResolvedValueOnce(undefined);

    await useAssetsStore.getState().remove("a1");

    expect(useAssetsStore.getState().assets).toEqual([]);
  });
});
