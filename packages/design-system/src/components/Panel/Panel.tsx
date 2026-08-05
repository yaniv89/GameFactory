import type { ReactNode } from "react";
import { Button } from "../Button/Button";
import type { ViewState } from "../shared/viewState";
import "./Panel.css";

export interface PanelEmptyProps {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}

export interface PanelErrorProps {
  title: string;
  description: string;
  onRetry: () => void;
}

export interface PanelPermissionDeniedProps {
  title: string;
  description: string;
}

export interface PanelOfflineProps {
  title: string;
  description: string;
}

export interface PanelProps {
  title: string;
  state: ViewState;
  children?: ReactNode;
  empty?: PanelEmptyProps;
  error?: PanelErrorProps;
  permissionDenied?: PanelPermissionDeniedProps;
  offline?: PanelOfflineProps;
}

/**
 * The canonical implementation of CLAUDE.md 5.4's six required states,
 * for the "container that shows a collection" shape (Scenes panel,
 * Modules panel, Problems panel, etc. from CLAUDE.md 5.5).
 */
export function Panel({
  title,
  state,
  children,
  empty,
  error,
  permissionDenied,
  offline,
}: PanelProps) {
  return (
    <section className="fg-panel" aria-label={title}>
      <div className="fg-panel__header">{title}</div>
      <div className="fg-panel__body">
        {state === "loading" && (
          <div role="status" aria-label={`Loading ${title.toLowerCase()}`}>
            <div className="fg-panel__skeleton-row" style={{ width: "80%" }} />
            <div className="fg-panel__skeleton-row" style={{ width: "60%" }} />
            <div className="fg-panel__skeleton-row" style={{ width: "70%" }} />
          </div>
        )}

        {state === "empty" && empty && (
          <div className="fg-panel__state">
            <span className="fg-panel__state-title">{empty.title}</span>
            <p>{empty.description}</p>
            <Button variant="primary" onClick={empty.onAction}>
              {empty.actionLabel}
            </Button>
          </div>
        )}

        {state === "error" && error && (
          <div className="fg-panel__state fg-panel__state--error" role="alert">
            <span className="fg-panel__state-title">{error.title}</span>
            <p>{error.description}</p>
            <Button variant="secondary" onClick={error.onRetry}>
              Retry
            </Button>
          </div>
        )}

        {state === "permission-denied" && permissionDenied && (
          <div className="fg-panel__state">
            <span className="fg-panel__state-title">{permissionDenied.title}</span>
            <p>{permissionDenied.description}</p>
          </div>
        )}

        {state === "offline" && offline && (
          <div className="fg-panel__state fg-panel__state--offline" role="status">
            <span className="fg-panel__state-title">{offline.title}</span>
            <p>{offline.description}</p>
          </div>
        )}

        {state === "populated" && children}
      </div>
    </section>
  );
}
