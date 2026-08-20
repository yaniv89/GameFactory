import { Button, Dialog, Input, Panel, type ViewState } from "@forge/ds";
import { useEffect, useRef, useState } from "react";
import type { AssetSummary } from "../api/assetsApi";
import "./AssetsLibraryDialog.css";

const STATUS_LABEL: Readonly<Record<AssetSummary["status"], string>> = {
  pending: "Queued",
  processing: "Processing",
  ready: "Ready",
  failed: "Failed",
};

export interface AssetsLibraryDialogProps {
  open: boolean;
  onClose: () => void;
  state: ViewState;
  assets: readonly AssetSummary[];
  onRetry: () => void;
  uploading: boolean;
  uploadError: string | undefined;
  onUpload: (path: string, file: File) => void;
  onDismissUploadError: () => void;
  onDelete: (assetId: string) => void;
  /** Fetches an authenticated object URL for a `Ready` asset's real content — a plain `<img src>` can't carry the Bearer token this needs (`fetchAssetContentUrl`'s own doc comment). Returns `undefined` on failure rather than throwing; a broken thumbnail is not a reason to lose the rest of the list. */
  loadThumbnail: (originalName: string) => Promise<string | undefined>;
}

/**
 * docs/adr/0012 E4: the editor's own upload/browse UI for a workspace's
 * `Asset` library — SPEC 11.4 tier 2, "project-uploaded asset." A file's
 * `originalName` doubles as its resolution path (the same one
 * `@forge/art-pack`'s `resolveAsset` and `GetAssetContentEndpoint.cs`
 * both key on) — naming an upload `tilesets/outdoor-base.png` is what
 * makes it override that path in the active pack; any other name is
 * simply a new asset under that name, available wherever project content
 * references it.
 */
export function AssetsLibraryDialog({
  open,
  onClose,
  state,
  assets,
  onRetry,
  uploading,
  uploadError,
  onUpload,
  onDismissUploadError,
  onDelete,
  loadThumbnail,
}: AssetsLibraryDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | undefined>(undefined);
  const [path, setPath] = useState("");

  // A clean slate on every open, same reasoning as PackSwapDialogContainer's
  // own reset-on-open effect: reopening should not silently resume a
  // half-filled upload form from a previous session.
  useEffect(() => {
    if (open) {
      setPendingFile(undefined);
      setPath("");
      onDismissUploadError();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleFileChosen = (file: File | undefined) => {
    setPendingFile(file);
    if (file && !path) setPath(file.name);
  };

  const handleUploadClick = () => {
    if (!pendingFile || !path.trim()) return;
    onUpload(path.trim(), pendingFile);
    setPendingFile(undefined);
    setPath("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <Dialog
      open={open}
      title="Asset Library"
      onClose={onClose}
      actions={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="fg-assets-library">
        <section aria-label="Upload an asset" className="fg-assets-library__upload">
          <Input
            ref={fileInputRef}
            type="file"
            label="File"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => handleFileChosen(e.target.files?.[0])}
          />
          <Input
            label="Path"
            hint="Matches how the active pack names its own files, e.g. tilesets/outdoor-base.png, to override it. Any other name is just a new asset."
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="tilesets/outdoor-base.png"
          />
          <Button variant="primary" loading={uploading} disabled={!pendingFile || !path.trim()} onClick={handleUploadClick}>
            Upload
          </Button>
          {uploadError && (
            <p className="fg-assets-library__upload-error" role="alert">
              {uploadError}
            </p>
          )}
        </section>

        <Panel
          title="Assets"
          state={state}
          empty={{
            title: "No assets uploaded yet",
            description: "Upload a PNG, JPEG, or WebP image above to add it to this workspace's asset library.",
            actionLabel: "Choose a file",
            onAction: () => fileInputRef.current?.focus(),
          }}
          error={{
            title: "Couldn't load your assets",
            description: "The request timed out. Your connection may be slow, or the server may be unavailable.",
            onRetry,
          }}
          permissionDenied={{
            title: "You have view access to this workspace",
            description: "Ask a workspace owner or admin for editor access to manage assets.",
          }}
          offline={{
            title: "Offline — can't load assets",
            description: "Reconnect to browse or upload assets.",
          }}
        >
          <ul className="fg-list fg-assets-library__list">
            {assets.map((asset) => (
              <AssetRow key={asset.id} asset={asset} onDelete={onDelete} loadThumbnail={loadThumbnail} />
            ))}
          </ul>
        </Panel>
      </div>
    </Dialog>
  );
}

function AssetRow({
  asset,
  onDelete,
  loadThumbnail,
}: {
  asset: AssetSummary;
  onDelete: (assetId: string) => void;
  loadThumbnail: (originalName: string) => Promise<string | undefined>;
}) {
  const [thumbnailUrl, setThumbnailUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (asset.status !== "ready") return;
    let cancelled = false;
    let objectUrl: string | undefined;
    void loadThumbnail(asset.originalName).then((url) => {
      if (cancelled) return;
      objectUrl = url;
      setThumbnailUrl(url);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.status, asset.originalName]);

  return (
    <li className="fg-assets-library__row">
      <div className="fg-assets-library__thumbnail" aria-hidden="true">
        {thumbnailUrl ? <img src={thumbnailUrl} alt="" /> : <span className={`fg-assets-library__status-icon fg-assets-library__status-icon--${asset.status}`} />}
      </div>
      <div>
        <span className="fg-list__primary">{asset.originalName}</span>
        <span className="fg-list__secondary">
          {STATUS_LABEL[asset.status]} · {(asset.sizeBytes / 1024).toFixed(1)} KB
          {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ""}
        </span>
        {asset.status === "failed" && asset.errorMessage && <p className="fg-assets-library__error-detail">{asset.errorMessage}</p>}
      </div>
      <Button variant="ghost" onClick={() => onDelete(asset.id)} aria-label={`Delete asset: ${asset.originalName}`}>
        Delete
      </Button>
    </li>
  );
}
