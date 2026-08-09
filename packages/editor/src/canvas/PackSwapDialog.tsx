import { Button, Dialog, Panel, Select, type ViewState } from "@forge/ds";
import type { PackSwapFinding, PackSwapSeverity } from "@forge/art-pack";
import { useRef } from "react";
import type { ActivePackContext } from "./packTiles";
import { PackSwapPreview } from "./PackSwapPreview";
import "./PackSwapDialog.css";

/** The Select option meaning "leave this terrain unmapped" — placeholders where a real target tag would go. */
const NO_REMAP_VALUE = "";

const SEVERITY_LABEL: Readonly<Record<PackSwapSeverity, string>> = { ok: "OK", warn: "WARN", fail: "FAIL" };

/** The dialog's own leaner view of a `PackSwapCheckpoint` — it never needs the snapshotted document itself. */
export interface PackSwapCheckpointSummary {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
}

export interface PackSwapDialogProps {
  open: boolean;
  onClose: () => void;
  /** `undefined` when no pack is active yet — applying is then a first install, not a swap. */
  currentPackName: string | undefined;
  availablePackNames: readonly string[];
  targetPackName: string | undefined;
  onSelectTarget: (packName: string) => void;
  /**
   * "empty" here means "a target is picked but nothing has started
   * loading yet" is never reached in practice (selecting a target
   * synchronously kicks off the fetch) — included for completeness with
   * `Panel`'s contract, not because this component drives into it itself.
   */
  diffState: ViewState;
  findings: readonly PackSwapFinding[];
  errorMessage?: string;
  onRetryDiff: () => void;
  applying: boolean;
  onApply: () => void;
  /** Newest first. Section 11.5's "one-click restore" — never empty-stated with a Panel: this is synchronous, already-in-memory local state, not something that can be loading, erroring, or offline. */
  checkpoints: readonly PackSwapCheckpointSummary[];
  onRestoreCheckpoint: (checkpointId: string) => void;
  onDeleteCheckpoint: (checkpointId: string) => void;
  /** Section 5.8's "live side-by-side preview with a draggable comparison divider." */
  previewOpen: boolean;
  onTogglePreview: () => void;
  /** `undefined` while the diff is still loading/erroring, or when there's no active pack to compare against. */
  sourceContext: ActivePackContext | undefined;
  targetContext: ActivePackContext | undefined;
  previewTiles: readonly number[];
  /** Section 11.5's "Remap manually" — source terrain tag -> the active pack's own substitute (`document.packTerrainRemap`). */
  terrainRemap: Readonly<Record<string, string>>;
  remapOpen: boolean;
  onToggleRemap: () => void;
  missingTerrains: readonly string[];
  targetTerrains: readonly string[];
  onSetTerrainRemap: (sourceTag: string, targetTag: string | undefined) => void;
}

/**
 * docs/SPEC.md Section 11.5 / Section 5.8's hero interaction, built end
 * to end: pick a target pack; see the real `diffPackSwap` compatibility
 * readout; open a live side-by-side render of the actual current tile
 * grid against both packs with a draggable comparison divider ("Preview
 * changes"); manually substitute a terrain tag the target pack doesn't
 * declare ("Remap manually") and watch the preview and, once applied,
 * the real canvas pick it up; Apply (which creates a named checkpoint
 * first, then swaps live) or Cancel; restore any past checkpoint with
 * one click. Character-sheet/animation findings have no "Remap
 * manually" control — see PackSwapDialogContainer/packTiles.ts's own
 * notes: no character sprite is pack-sourced on the canvas yet (entity
 * markers are synthetic shapes), so a remap control for them would
 * change nothing real, which is exactly the kind of stub CLAUDE.md
 * forbids. Terrain remap is scoped to what actually renders.
 */
export function PackSwapDialog({
  open,
  onClose,
  currentPackName,
  availablePackNames,
  targetPackName,
  onSelectTarget,
  diffState,
  findings,
  errorMessage,
  onRetryDiff,
  applying,
  onApply,
  checkpoints,
  onRestoreCheckpoint,
  onDeleteCheckpoint,
  previewOpen,
  onTogglePreview,
  sourceContext,
  targetContext,
  previewTiles,
  terrainRemap,
  remapOpen,
  onToggleRemap,
  missingTerrains,
  targetTerrains,
  onSetTerrainRemap,
}: PackSwapDialogProps) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const hasFailures = findings.some((finding) => finding.severity === "fail");
  const targetOptions = availablePackNames
    .filter((name) => name !== currentPackName)
    .map((name) => ({ value: name, label: name }));
  const canPreviewOrRemap = diffState === "populated";

  return (
    <Dialog
      open={open}
      title={targetPackName ? `Switching ${currentPackName ?? "no pack active"} → ${targetPackName}` : "Swap Art Pack"}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={applying}
            disabled={!targetPackName || diffState !== "populated"}
            onClick={onApply}
          >
            {hasFailures ? "Apply anyway" : "Apply swap"}
          </Button>
        </>
      }
    >
      <div className="fg-pack-swap-dialog">
        <Select
          ref={selectRef}
          label="Switch to"
          placeholder="Choose a pack"
          options={targetOptions}
          value={targetPackName ?? ""}
          onChange={(e) => onSelectTarget(e.target.value)}
        />

        {!targetPackName && (
          <p className="fg-pack-swap-dialog__hint">Choose a pack above to see what carries over and what doesn&rsquo;t.</p>
        )}

        {targetPackName && (
          <Panel
            title="Compatibility"
            state={diffState}
            empty={{
              title: "Choose a pack to compare",
              description: "Pick a target pack above to see the compatibility diff.",
              actionLabel: "Choose a pack",
              onAction: () => selectRef.current?.focus(),
            }}
            error={{
              title: "This pack can't be compared",
              description: errorMessage ?? "The target pack's manifest is missing or invalid.",
              onRetry: onRetryDiff,
            }}
            // Neither of these two is reachable through the container yet
            // — no per-project role concept exists client-side for
            // permission-denied, and a failed manifest fetch is a single
            // request's own "error" (with its Retry action), not the
            // app-wide connectivity state "offline" means elsewhere
            // (ModulesPanel's own "syncs automatically" framing). Declared
            // anyway, with honest copy, the same stance ModulesPanel takes
            // on its own not-yet-reachable states — the full six-state
            // contract exists in the component now, real triggers land
            // when the backend plumbing (M5) does.
            permissionDenied={{
              title: "You have view access to this project",
              description: "Ask the project owner for editor access to swap Art Packs.",
            }}
            offline={{
              title: "Couldn't reach the pack",
              description: "The manifest request failed. Check your connection and try again.",
            }}
          >
            <ul className="fg-pack-swap-dialog__findings">
              {findings.map((finding, index) => (
                <li key={index} className={`fg-pack-swap-dialog__finding fg-pack-swap-dialog__finding--${finding.severity}`}>
                  <span className="fg-pack-swap-dialog__severity" aria-hidden="true" />
                  <div>
                    <span className="fg-pack-swap-dialog__severity-label">{SEVERITY_LABEL[finding.severity]}</span>{" "}
                    <span>{finding.message}</span>
                    {finding.detail && <p className="fg-pack-swap-dialog__detail">{finding.detail}</p>}
                  </div>
                </li>
              ))}
              {findings.length === 0 && <li className="fg-pack-swap-dialog__finding">Nothing to compare — the target pack declares no overlapping content.</li>}
            </ul>
          </Panel>
        )}

        {targetPackName && canPreviewOrRemap && (
          <div className="fg-pack-swap-dialog__toggle-row">
            <Button variant="secondary" aria-expanded={previewOpen} onClick={onTogglePreview}>
              {previewOpen ? "Hide preview" : "Preview changes"}
            </Button>
            {missingTerrains.length > 0 && (
              <Button variant="secondary" aria-expanded={remapOpen} onClick={onToggleRemap}>
                {remapOpen ? "Hide remap" : "Remap manually"}
              </Button>
            )}
          </div>
        )}

        {targetPackName && canPreviewOrRemap && previewOpen && (
          <PackSwapPreview
            sourceContext={sourceContext}
            targetContext={targetContext}
            terrainRemap={terrainRemap}
            tiles={previewTiles}
            sourceLabel={currentPackName ?? "No pack active"}
            targetLabel={targetPackName}
          />
        )}

        {targetPackName && canPreviewOrRemap && remapOpen && missingTerrains.length > 0 && (
          <section aria-label="Remap terrains manually" className="fg-pack-swap-dialog__remap">
            <h3 className="fg-pack-swap-dialog__section-title">Remap manually</h3>
            <p className="fg-pack-swap-dialog__hint">
              {targetPackName} doesn&rsquo;t declare these terrains. Pick one of its own tiles to stand in, or leave
              them as placeholders.
            </p>
            {missingTerrains.map((tag) => (
              <Select
                key={tag}
                label={`'${tag}' ->`}
                // "No substitute" is a real, always-selectable option here
                // rather than `Select`'s own `placeholder` prop — that
                // prop renders a disabled option meant for "nothing
                // chosen yet," not something a person can pick again once
                // they've already chosen a substitute (found the hard way:
                // it made clearing a remap back to "placeholder" a dead
                // click in this component's own test).
                options={[
                  { value: NO_REMAP_VALUE, label: "No substitute (placeholder)" },
                  ...targetTerrains.map((targetTag) => ({ value: targetTag, label: targetTag })),
                ]}
                value={terrainRemap[tag] ?? NO_REMAP_VALUE}
                onChange={(e) => onSetTerrainRemap(tag, e.target.value === NO_REMAP_VALUE ? undefined : e.target.value)}
              />
            ))}
          </section>
        )}

        <section aria-label="Checkpoints">
          <h3 className="fg-pack-swap-dialog__section-title">Checkpoints</h3>
          {checkpoints.length === 0 ? (
            <p className="fg-pack-swap-dialog__hint">
              No checkpoints yet — applying a swap automatically creates one here first.
            </p>
          ) : (
            <ul className="fg-pack-swap-dialog__checkpoints">
              {checkpoints.map((checkpoint) => (
                <li key={checkpoint.id} className="fg-pack-swap-dialog__checkpoint-row">
                  <div className="fg-pack-swap-dialog__checkpoint-meta">
                    <span>{checkpoint.label}</span>
                    <span className="fg-pack-swap-dialog__checkpoint-time">
                      {new Date(checkpoint.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <Button variant="secondary" onClick={() => onRestoreCheckpoint(checkpoint.id)}>
                      Restore
                    </Button>
                    <Button variant="ghost" onClick={() => onDeleteCheckpoint(checkpoint.id)} aria-label={`Delete checkpoint: ${checkpoint.label}`}>
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Dialog>
  );
}
