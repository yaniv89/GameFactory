import { diffPackSwap, type PackSwapFinding } from "@forge/art-pack";
import type { ViewState } from "@forge/ds";
import { useEffect, useState } from "react";
import { useCanvasPreviewStore } from "./canvasPreviewStore";
import { GRID_HEIGHT, GRID_WIDTH } from "./gridConstants";
import { PackSwapDialog } from "./PackSwapDialog";
import { listKnownPackNames, loadPackManifest, type ActivePackContext } from "./packTiles";
import { useProjectStore } from "../store/projectStore";

interface DiffOutcome {
  readonly state: ViewState;
  readonly findings: readonly PackSwapFinding[];
  readonly errorMessage?: string;
  readonly missingTerrains: readonly string[];
  readonly targetTerrains: readonly string[];
  /** Loaded alongside the diff so "Preview changes" never re-fetches what this already has. */
  readonly sourceContext?: ActivePackContext;
  readonly targetContext?: ActivePackContext;
}

const LOADING: DiffOutcome = { state: "loading", findings: [], missingTerrains: [], targetTerrains: [] };
// A stable reference, not `new Array(...).fill(0)` inline at the call
// site: that would allocate a fresh array every render, and passing it
// as PackSwapPreview's `tiles` prop would re-trigger its render effect
// (whose deps include `tiles`) on every single parent re-render — an
// unbounded loop — whenever nothing has been painted yet.
const EMPTY_TILES: readonly number[] = new Array(GRID_WIDTH * GRID_HEIGHT).fill(0);

async function computeDiff(currentPackName: string | undefined, targetPackName: string): Promise<DiffOutcome> {
  const target = await loadPackManifest(targetPackName);
  if (!target.ok) {
    // `Panel`'s "offline" state is a global-connectivity indicator with no
    // retry action (see ModulesPanel's own "syncs automatically" copy) —
    // the wrong fit for one failed manifest fetch, which is exactly a
    // "this specific request failed, try again" case. "error" (with its
    // Retry button) covers a network failure and an invalid/unknown pack
    // alike here; `errorMessage` still says which one happened.
    return { state: "error", findings: [], errorMessage: target.message, missingTerrains: [], targetTerrains: [] };
  }
  const targetContext: ActivePackContext = { packName: target.packName, manifest: target.manifest, baseUrl: target.baseUrl };

  if (!currentPackName) {
    // Nothing active to compare against — this is a first install, not a
    // swap (docs/SPEC.md Section 11.5 is specifically about switching
    // *between* two packs). Represented as a real, honest finding rather
    // than a special-cased empty message, so the dialog's render logic
    // doesn't need to know about this case at all.
    return {
      state: "populated",
      findings: [{ severity: "ok", message: `No pack is currently active — this installs ${targetPackName} directly.` }],
      missingTerrains: [],
      targetTerrains: Array.from(new Set(Object.values(target.manifest.tilesets).flatMap((tileset) => tileset.terrains))).sort(),
      targetContext,
    };
  }

  const source = await loadPackManifest(currentPackName);
  if (!source.ok) {
    return {
      state: "error",
      findings: [],
      errorMessage: `The currently active pack ('${currentPackName}') failed to load: ${source.message}`,
      missingTerrains: [],
      targetTerrains: [],
    };
  }
  const sourceContext: ActivePackContext = { packName: source.packName, manifest: source.manifest, baseUrl: source.baseUrl };

  const diff = diffPackSwap(source.manifest, target.manifest);
  return {
    state: "populated",
    findings: diff.findings,
    missingTerrains: diff.missingTerrains,
    targetTerrains: diff.targetTerrains,
    sourceContext,
    targetContext,
  };
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
  const terrainRemap = useProjectStore((state) => state.document.packTerrainRemap);
  const setTerrainRemap = useProjectStore((state) => state.setTerrainRemap);
  // SceneCanvas publishes its live tile grid here on every paint (Phase 6's
  // preview bridge) — reused as-is for the side-by-side preview's own tile
  // data, rather than a second, duplicate source of truth. Falls back to
  // an all-empty grid when nothing's been painted yet, matching
  // TilemapLayer's own "no tiles painted" starting state.
  const liveTiles = useCanvasPreviewStore((state) => state.tiles);

  const [targetPackName, setTargetPackName] = useState<string | undefined>(undefined);
  const [outcome, setOutcome] = useState<DiffOutcome>(LOADING);
  const [applying, setApplying] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [remapOpen, setRemapOpen] = useState(false);

  // Resets to a clean slate every time the dialog is (re)opened, rather
  // than carrying over whatever the last session picked — reopening
  // should not silently resume a half-finished comparison.
  useEffect(() => {
    if (open) {
      setTargetPackName(undefined);
      setOutcome(LOADING);
      setPreviewOpen(false);
      setRemapOpen(false);
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
      onSelectTarget={(name) => {
        setTargetPackName(name);
        setPreviewOpen(false);
        setRemapOpen(false);
      }}
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
      previewOpen={previewOpen}
      onTogglePreview={() => setPreviewOpen((wasOpen) => !wasOpen)}
      sourceContext={outcome.sourceContext}
      targetContext={outcome.targetContext}
      previewTiles={liveTiles ?? EMPTY_TILES}
      terrainRemap={terrainRemap}
      remapOpen={remapOpen}
      onToggleRemap={() => setRemapOpen((wasOpen) => !wasOpen)}
      missingTerrains={outcome.missingTerrains}
      targetTerrains={outcome.targetTerrains}
      onSetTerrainRemap={setTerrainRemap}
    />
  );
}
