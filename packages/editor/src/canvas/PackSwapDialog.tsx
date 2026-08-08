import { Button, Dialog, Panel, Select, type ViewState } from "@forge/ds";
import type { PackSwapFinding, PackSwapSeverity } from "@forge/art-pack";
import { useRef } from "react";
import "./PackSwapDialog.css";

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
}

/**
 * docs/SPEC.md Section 11.5 / Section 5.8's hero interaction: a
 * compatibility diff between the active pack and a candidate replacement,
 * real findings from `diffPackSwap` (not a mock), gated behind an
 * automatic named checkpoint the caller creates before applying (see
 * PackSwapDialogContainer). Deliberately narrower than the spec's own
 * mockup: no live side-by-side canvas preview with a draggable divider,
 * and no "Remap manually" flow — both are real, unbuilt features (a
 * second rendering pass and a per-asset remap UI, respectively), and
 * shipping buttons for them here would be exactly the "stub that returns
 * hardcoded data" CLAUDE.md forbids. What's here is real end to end:
 * pick a target, see the actual diff, apply it and watch the canvas
 * update live, or restore the checkpoint from before.
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
}: PackSwapDialogProps) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const hasFailures = findings.some((finding) => finding.severity === "fail");
  const targetOptions = availablePackNames
    .filter((name) => name !== currentPackName)
    .map((name) => ({ value: name, label: name }));

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
