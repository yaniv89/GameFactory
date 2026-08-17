import { useEffect } from "react";
import { fetchAssetContentUrl } from "../api/assetsApi";
import { useProjectsStore } from "../project/projectsStore";
import { useAssetsStore } from "../project/assetsStore";
import { AssetsLibraryDialog } from "./AssetsLibraryDialog";

export interface AssetsLibraryDialogContainerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Wires `useAssetsStore` to the presentational `AssetsLibraryDialog` —
 * the same split `PackSwapDialogContainer` uses. Reuses
 * `useProjectsStore`'s already-resolved workspace (docs/adr/0012 E4: no
 * new workspace-resolution logic needed, the same "first workspace the
 * account has" simplification `projectsStore.ts`'s own `pickWorkspace`
 * already documents).
 */
export function AssetsLibraryDialogContainer({ open, onClose }: AssetsLibraryDialogContainerProps) {
  const workspaceId = useProjectsStore((state) => state.workspace?.workspaceId);
  const status = useAssetsStore((state) => state.status);
  const assets = useAssetsStore((state) => state.assets);
  const uploading = useAssetsStore((state) => state.uploading);
  const uploadError = useAssetsStore((state) => state.uploadError);
  const load = useAssetsStore((state) => state.load);
  const upload = useAssetsStore((state) => state.upload);
  const remove = useAssetsStore((state) => state.remove);
  const clearUploadError = useAssetsStore((state) => state.clearUploadError);

  useEffect(() => {
    if (open && workspaceId) void load(workspaceId);
  }, [open, workspaceId, load]);

  return (
    <AssetsLibraryDialog
      open={open}
      onClose={onClose}
      state={status}
      assets={assets}
      onRetry={() => workspaceId && void load(workspaceId)}
      uploading={uploading}
      uploadError={uploadError}
      onUpload={(path, file) => workspaceId && void upload(workspaceId, path, file)}
      onDismissUploadError={clearUploadError}
      onDelete={(assetId) => void remove(assetId)}
      loadThumbnail={async (originalName) => {
        if (!workspaceId) return undefined;
        try {
          return await fetchAssetContentUrl(workspaceId, originalName);
        } catch {
          // A broken thumbnail isn't a reason to lose the rest of the
          // list (AssetsLibraryDialog's own loadThumbnail doc comment) —
          // the row still shows the status dot and metadata either way.
          return undefined;
        }
      }}
    />
  );
}
