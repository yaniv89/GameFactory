import { Panel, type ViewState } from "@forge/ds";
import type { ReactNode } from "react";

export interface InspectorPanelProps {
  state: ViewState;
  selectionLabel?: string;
  children?: ReactNode;
  onRetry?: () => void;
}

/**
 * The JSON-Schema-driven property editor lands in Phase 4 (React Hook
 * Form + Zod, compiled from a module's configSchema). For Phase 1 this is
 * the shell only: with nothing selected, "empty" is the honest state —
 * there is no fake placeholder property list.
 */
export function InspectorPanel({ state, selectionLabel, children, onRetry }: InspectorPanelProps) {
  return (
    <Panel
      title="Inspector"
      state={state}
      empty={{
        title: "Nothing selected",
        description: "Select an entity, tile, or scene element to see and edit its properties here.",
        actionLabel: "Open Scenes panel",
        onAction: () => {},
      }}
      error={{
        title: "Couldn't load properties",
        description: "The request timed out. Try selecting the item again.",
        onRetry: onRetry ?? (() => {}),
      }}
      permissionDenied={{
        title: "You have view access to this project",
        description: "Ask the project owner for editor access to change properties.",
      }}
      offline={{
        title: "Offline — changes stored locally",
        description: "Property edits will sync automatically when you reconnect.",
      }}
    >
      <div className="fg-inspector__selection">{selectionLabel}</div>
      {children}
    </Panel>
  );
}
