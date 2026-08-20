import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AssetSummary } from "../api/assetsApi";
import { AssetsLibraryDialog } from "./AssetsLibraryDialog";

const NOOP = () => {};
const NO_THUMBNAIL = async () => undefined;

const READY_ASSET: AssetSummary = {
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

const FAILED_ASSET: AssetSummary = {
  id: "a2",
  projectId: undefined,
  originalName: "corrupt.png",
  status: "failed",
  sizeBytes: 512,
  width: undefined,
  height: undefined,
  errorMessage: "This file isn't a valid PNG, JPEG, or WebP image.",
  createdAt: "2026-01-01T00:00:00Z",
  completedAt: "2026-01-01T00:00:05Z",
};

describe("AssetsLibraryDialog", () => {
  it("lists assets with their status and lets a person delete one", async () => {
    const onDelete = vi.fn();
    render(
      <AssetsLibraryDialog
        open
        onClose={NOOP}
        state="populated"
        assets={[READY_ASSET, FAILED_ASSET]}
        onRetry={NOOP}
        uploading={false}
        uploadError={undefined}
        onUpload={NOOP}
        onDismissUploadError={NOOP}
        onDelete={onDelete}
        loadThumbnail={NO_THUMBNAIL}
      />,
    );

    expect(screen.getByText("tilesets/outdoor-base.png")).toBeInTheDocument();
    expect(screen.getByText(/Ready/)).toBeInTheDocument();
    expect(screen.getByText("corrupt.png")).toBeInTheDocument();
    expect(screen.getByText(/Failed/)).toBeInTheDocument();
    expect(screen.getByText("This file isn't a valid PNG, JPEG, or WebP image.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete asset: tilesets/outdoor-base.png" }));
    expect(onDelete).toHaveBeenCalledWith("a1");
  });

  it("shows the empty-state copy when there are no assets yet", () => {
    render(
      <AssetsLibraryDialog
        open
        onClose={NOOP}
        state="empty"
        assets={[]}
        onRetry={NOOP}
        uploading={false}
        uploadError={undefined}
        onUpload={NOOP}
        onDismissUploadError={NOOP}
        onDelete={NOOP}
        loadThumbnail={NO_THUMBNAIL}
      />,
    );

    expect(screen.getByText("No assets uploaded yet")).toBeInTheDocument();
  });

  it("shows the error state with a retry action", async () => {
    const onRetry = vi.fn();
    render(
      <AssetsLibraryDialog
        open
        onClose={NOOP}
        state="error"
        assets={[]}
        onRetry={onRetry}
        uploading={false}
        uploadError={undefined}
        onUpload={NOOP}
        onDismissUploadError={NOOP}
        onDelete={NOOP}
        loadThumbnail={NO_THUMBNAIL}
      />,
    );

    expect(screen.getByText("Couldn't load your assets")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows the permission-denied state", () => {
    render(
      <AssetsLibraryDialog
        open
        onClose={NOOP}
        state="permission-denied"
        assets={[]}
        onRetry={NOOP}
        uploading={false}
        uploadError={undefined}
        onUpload={NOOP}
        onDismissUploadError={NOOP}
        onDelete={NOOP}
        loadThumbnail={NO_THUMBNAIL}
      />,
    );

    expect(screen.getByText("You have view access to this workspace")).toBeInTheDocument();
  });

  it("shows the offline state", () => {
    render(
      <AssetsLibraryDialog
        open
        onClose={NOOP}
        state="offline"
        assets={[]}
        onRetry={NOOP}
        uploading={false}
        uploadError={undefined}
        onUpload={NOOP}
        onDismissUploadError={NOOP}
        onDelete={NOOP}
        loadThumbnail={NO_THUMBNAIL}
      />,
    );

    expect(screen.getByText("Offline — can't load assets")).toBeInTheDocument();
  });

  it("disables Upload until both a file and a path are present, and defaults the path to the file name", async () => {
    const onUpload = vi.fn();
    render(
      <AssetsLibraryDialog
        open
        onClose={NOOP}
        state="empty"
        assets={[]}
        onRetry={NOOP}
        uploading={false}
        uploadError={undefined}
        onUpload={onUpload}
        onDismissUploadError={NOOP}
        onDelete={NOOP}
        loadThumbnail={NO_THUMBNAIL}
      />,
    );

    const uploadButton = screen.getByRole("button", { name: "Upload" });
    expect(uploadButton).toBeDisabled();

    const file = new File(["fake-png-bytes"], "outdoor-base.png", { type: "image/png" });
    const fileInput = screen.getByLabelText("File");
    await userEvent.upload(fileInput, file);

    const pathInput = screen.getByLabelText("Path") as HTMLInputElement;
    expect(pathInput.value).toBe("outdoor-base.png");
    expect(uploadButton).toBeEnabled();

    await userEvent.clear(pathInput);
    await userEvent.type(pathInput, "tilesets/outdoor-base.png");
    await userEvent.click(uploadButton);

    expect(onUpload).toHaveBeenCalledWith("tilesets/outdoor-base.png", file);
  });

  it("shows an upload error without blocking the list", () => {
    render(
      <AssetsLibraryDialog
        open
        onClose={NOOP}
        state="populated"
        assets={[READY_ASSET]}
        onRetry={NOOP}
        uploading={false}
        uploadError="File too large. The limit is 10485760 bytes."
        onUpload={NOOP}
        onDismissUploadError={NOOP}
        onDelete={NOOP}
        loadThumbnail={NO_THUMBNAIL}
      />,
    );

    expect(screen.getByText("File too large. The limit is 10485760 bytes.")).toBeInTheDocument();
    expect(screen.getByText("tilesets/outdoor-base.png")).toBeInTheDocument();
  });
});
