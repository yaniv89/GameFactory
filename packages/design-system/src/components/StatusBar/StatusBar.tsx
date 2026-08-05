import "./StatusBar.css";

export type SaveStatus = "saved" | "saving" | "unsaved" | "offline";

export interface StatusBarProps {
  status: SaveStatus;
}

const LABEL: Record<SaveStatus, string> = {
  saved: "Saved",
  saving: "Saving…",
  unsaved: "Unsaved changes",
  offline: "Offline — changes stored locally",
};

/**
 * The literal status-bar states from CLAUDE.md 5.3 rule 6: never show
 * "Saved" optimistically before the server confirms. This is a narrower,
 * more specific contract than the six-state view framework in 5.4 — a
 * status bar isn't a data view, it's a save-state indicator — so it has
 * its own four states rather than reusing ViewState.
 */
export function StatusBar({ status }: StatusBarProps) {
  return (
    <div className={`fg-statusbar fg-statusbar--${status}`} role="status" aria-live="polite">
      <span className="fg-statusbar__dot" aria-hidden="true" />
      <span>{LABEL[status]}</span>
    </div>
  );
}
