import { Button, Panel, type ViewState } from "@forge/ds";
import "./HistoryPanel.css";

export interface HistoryPanelRevision {
  readonly id: number;
  readonly label: string | undefined;
  readonly isCheckpoint: boolean;
  readonly createdAt: string;
  /** Whether this row is the revision currently loaded on the canvas — restoring it would be a no-op, so its Restore button is disabled instead of hidden (still visible, still explains why). */
  readonly isCurrent: boolean;
}

export interface HistoryPanelProps {
  state: ViewState;
  revisions?: readonly HistoryPanelRevision[];
  hasMore?: boolean;
  loadingMore?: boolean;
  /** The revision id a restore is currently in flight for, so only that row shows a pending state rather than the whole list looking busy. */
  restoringId?: number | undefined;
  onRetry?: () => void;
  onLoadMore?: () => void;
  onRestore?: (revisionId: number) => void;
  /** Empty-state action: history is populated by saving, not by a create flow, so this triggers an actual save rather than a no-op. */
  onSaveNow?: () => void;
}

/**
 * Pure presentational component — same Container/View split as
 * `ScenesPanel`/`ScenesPanelContainer` (`shell/DockviewPanels.tsx`). See
 * `HistoryPanelContainer` for the dockview-shaped wrapper that supplies
 * real data from `revisionHistoryStore`/`projectSyncStore` and owns the
 * restore confirmation dialog — this component only ever asks for a
 * restore, it never confirms one, so it can't accidentally fire the
 * request straight from a click.
 */
export function HistoryPanel({
  state,
  revisions = [],
  hasMore = false,
  loadingMore = false,
  restoringId,
  onRetry,
  onLoadMore,
  onRestore,
  onSaveNow,
}: HistoryPanelProps) {
  return (
    <Panel
      title="History"
      state={state}
      empty={{
        title: "No saved versions yet",
        description: "Every save becomes a point you can come back to. Save your work to start the history.",
        actionLabel: "Save now",
        onAction: onSaveNow ?? (() => {}),
      }}
      error={{
        title: "Couldn't load history",
        description: "The request timed out. Your connection may be slow or the project may be very large.",
        onRetry: onRetry ?? (() => {}),
      }}
      permissionDenied={{
        title: "You have view access to this project",
        description: "Ask the project owner for editor access to see and restore past versions.",
      }}
      offline={{
        title: "Offline — history isn't available",
        description: "Past versions will load once you're back online.",
      }}
    >
      <ul className="fg-history__list">
        {revisions.map((revision) => (
          <li key={revision.id} className="fg-history__row">
            <div className="fg-history__row-main">
              <span className="fg-history__label">
                {revision.label ?? `Revision ${revision.id}`}
                {revision.isCheckpoint && <span className="fg-history__badge">Checkpoint</span>}
                {revision.isCurrent && <span className="fg-history__badge fg-history__badge--current">Current</span>}
              </span>
              <span className="fg-history__timestamp">{new Date(revision.createdAt).toLocaleString()}</span>
            </div>
            <Button
              variant="secondary"
              disabled={revision.isCurrent || restoringId !== undefined}
              onClick={() => onRestore?.(revision.id)}
            >
              {restoringId === revision.id ? "Restoring…" : "Restore"}
            </Button>
          </li>
        ))}
      </ul>
      {hasMore && (
        <Button variant="secondary" onClick={onLoadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </Button>
      )}
    </Panel>
  );
}
