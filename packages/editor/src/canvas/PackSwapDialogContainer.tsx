import { diffPackSwap, type PackSwapFinding } from "@forge/art-pack";
import type { ViewState } from "@forge/ds";
import { useEffect, useState } from "react";
import { PackSwapDialog } from "./PackSwapDialog";
import { listKnownPackNames, loadPackManifest } from "./packTiles";
import { useProjectStore } from "../store/projectStore";

interface DiffOutcome {
  readonly state: ViewState;
  readonly findings: readonly PackSwapFinding[];
  readonly errorMessage?: string;
}

const LOADING: DiffOutcome = { state: "loading", findings: [] };

async function computeDiff(currentPackName: string | undefined, targetPackName: string): Promise<DiffOutcome> {
  const target = await loadPackManifest(targetPackName);
  if (!target.ok) {
    // `Panel`'s "offline" state is a global-connectivity indicator with no
    // retry action (see ModulesPanel's own "syncs automatically" copy) —
    // the wrong fit for one failed manifest fetch, which is exactly a
    // "this specific request failed, try again" case. "error" (with its
    // Retry button) covers a network failure and an invalid/unknown pack
    // alike here; `errorMessage` still says which one happened.
    return { state: "error", findings: [], errorMessage: target.message };
  }

  if (!currentPackName) {
    // Nothing active to compare against — this is a first install, not a
    // swap (docs/SPEC.md Section 11.5 is specifically about switching
    // *between* two packs). Represented as a real, honest finding rather
    // than a special-cased empty message, so the dialog's render logic
    // doesn't need to know about this case at all.
    return {
      state: "populated",
      findings: [{ severity: "ok", message: `No pack is currently active — this installs ${targetPackName} directly.` }],
    };
  }

  const source = await loadPackManifest(currentPackName);
  if (!source.ok) {
    return {
      state: "error",
      findings: [],
      errorMessage: `The currently active pack ('${currentPackName}') failed to load: ${source.message}`,
    };
  }

  return { state: "populated", findings: diffPackSwap(source.manifest, target.manifest).findings };
}

export interface PackSwapDialogContainerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Owns the async diff-loading state machine and the real store writes
 * Section 11.5's "automatic named checkpoint before applying" and
 * "one-click restore" require — the presentational `PackSwapDialog`
 * itself only renders whatever props it's given.
 */
export function PackSwapDialogContainer({ open, onClose }: PackSwapDialogContainerProps) {
  const currentPackName = useProjectStore((state) => state.document.activePack);
  const setActivePack = useProjectStore((state) => state.setActivePack);
  const createCheckpoint = useProjectStore((state) => state.createCheckpoint);
  const checkpoints = useProjectStore((state) => state.checkpoints);
  const restoreCheckpoint = useProjectStore((state) => state.restoreCheckpoint);
  const deleteCheckpoint = useProjectStore((state) => state.deleteCheckpoint);

  const [targetPackName, setTargetPackName] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<DiffOutcome>(LOADING);
  const [applying, setApplying] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  // Resets to a clean slate every time the dialog is (re)opened, rather
  // than carrying over whatever the last session picked — reopening
  // should not silently resume a half-finished comparison.
  useEffect(() => {
    if (open) {
      setTargetPackName(undefined);
      setOutcome(LOADING);
    }
  }, [open]);

  useEffect(() => {
    if (!targetPackName) return;
    let cancelled = false;
    setOutcome(LOADING);
    void computeDiff(currentPackName, targetPackName).then((result) => {
      if (!cancelled) setOutcome(result);
    });
    return () => {
      cancelled = true;
    };
  }, [currentPackName, targetPackName, reloadToken]);

  const handleApply = async (): Promise<void> => {
    if (!targetPackName) return;
    setApplying(true);
    try {
      const label = currentPackName ? `Before switching from ${currentPackName} to ${targetPackName}` : `Before installing ${targetPackName}`;
      createCheckpoint(label);
      setActivePack(targetPackName);
      onClose();
    } finally {
      setApplying(false);
    }
  };

  return (
    <PackSwapDialog
      open={open}
      onClose={onClose}
      currentPackName={currentPackName}
      availablePackNames={listKnownPackNames()}
      targetPackName={targetPackName}
      onSelectTarget={setTargetPackName}
      diffState={outcome.state}
      findings={outcome.findings}
      {...(outcome.errorMessage !== undefined ? { errorMessage: outcome.errorMessage } : {})}
      onRetryDiff={() => setReloadToken((token) => token + 1)}
      applying={applying}
      onApply={() => void handleApply()}
      // Store order is oldest-first (append-on-create); the dialog wants
      // newest-first so the checkpoint from the swap someone just made is
      // the one they see first, not scrolled below every older one.
      checkpoints={[...checkpoints].reverse()}
      onRestoreCheckpoint={(checkpointId) => {
        restoreCheckpoint(checkpointId);
        onClose();
      }}
      onDeleteCheckpoint={deleteCheckpoint}
    />
  );
}
