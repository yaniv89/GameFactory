import { useEffect } from "react";
import { fetchVariationContentUrl } from "../api/artGenerationApi";
import { useArtGenerationStore } from "../project/artGenerationStore";
import { useProjectsStore } from "../project/projectsStore";
import { DescribeItDialog } from "./DescribeItDialog";

export interface DescribeItDialogContainerProps {
  open: boolean;
  onClose: () => void;
  projectId: string | undefined;
}

/**
 * Wires `useArtGenerationStore` to the presentational `DescribeItDialog`
 * — the same container/store split every other dialog in this package
 * uses. Reuses `useProjectsStore`'s already-resolved workspace, the same
 * simplification `AssetsLibraryDialogContainer` already makes.
 */
export function DescribeItDialogContainer({ open, onClose, projectId }: DescribeItDialogContainerProps) {
  const workspaceId = useProjectsStore((state) => state.workspace?.workspaceId);
  const submitting = useArtGenerationStore((state) => state.submitting);
  const submitError = useArtGenerationStore((state) => state.submitError);
  const retryAfterSeconds = useArtGenerationStore((state) => state.retryAfterSeconds);
  const request = useArtGenerationStore((state) => state.request);
  const pollState = useArtGenerationStore((state) => state.pollState);
  const pollError = useArtGenerationStore((state) => state.pollError);
  const confirming = useArtGenerationStore((state) => state.confirming);
  const confirmError = useArtGenerationStore((state) => state.confirmError);
  const selecting = useArtGenerationStore((state) => state.selecting);
  const selectError = useArtGenerationStore((state) => state.selectError);
  const create = useArtGenerationStore((state) => state.create);
  const confirm = useArtGenerationStore((state) => state.confirm);
  const select = useArtGenerationStore((state) => state.select);
  const reset = useArtGenerationStore((state) => state.reset);

  // A clean slate every time the dialog closes -- stops any in-flight
  // poll (the store's own `reset` doc comment) rather than letting it
  // keep ticking against a dialog nobody can see anymore.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  return (
    <DescribeItDialog
      open={open}
      onClose={onClose}
      submitting={submitting}
      submitError={submitError}
      retryAfterSeconds={retryAfterSeconds}
      onSubmit={(userPrompt, category) => workspaceId && projectId && void create(workspaceId, projectId, userPrompt, category)}
      request={request}
      pollState={pollState}
      pollError={pollError}
      confirming={confirming}
      confirmError={confirmError}
      onConfirm={() => workspaceId && projectId && void confirm(workspaceId, projectId)}
      onStartOver={reset}
      selecting={selecting}
      selectError={selectError}
      onSelect={(variationId, assetName) =>
        workspaceId && projectId ? select(workspaceId, projectId, variationId, assetName) : Promise.resolve(undefined)
      }
      loadVariationThumbnail={async (variationId) => {
        if (!workspaceId || !projectId || !request) return undefined;
        try {
          return await fetchVariationContentUrl(workspaceId, projectId, request.id, variationId);
        } catch {
          // A broken thumbnail isn't a reason to lose the rest of the
          // grid (DescribeItDialog's own loadVariationThumbnail doc
          // comment) — the "Use this" button still works from the
          // placeholder.
          return undefined;
        }
      }}
    />
  );
}
