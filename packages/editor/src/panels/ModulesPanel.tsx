import { Panel, type ViewState } from "@forge/ds";

export interface ModuleSummary {
  readonly name: string;
  readonly summary: string;
}

export interface ModulesPanelProps {
  state: ViewState;
  modules?: readonly ModuleSummary[];
  onBrowseMarketplace: () => void;
  onRetry?: () => void;
}

/**
 * Lists modules installed in the current project. The marketplace browse
 * flow (registry search, install, capability consent) is M6/M7 — this
 * panel only renders what's already installed.
 */
export function ModulesPanel({ state, modules = [], onBrowseMarketplace, onRetry }: ModulesPanelProps) {
  return (
    <Panel
      title="Modules"
      state={state}
      empty={{
        title: "No modules installed",
        description: "Modules add behavior — dialogue, inventory, combat — that you drag into scenes.",
        actionLabel: "Browse the marketplace",
        onAction: onBrowseMarketplace,
      }}
      error={{
        title: "Couldn't load installed modules",
        description: "The request timed out. Your connection may be slow or the project may be very large.",
        onRetry: onRetry ?? (() => {}),
      }}
      permissionDenied={{
        title: "You have view access to this project",
        description: "Ask the project owner for editor access to install or remove modules.",
      }}
      offline={{
        title: "Offline — changes stored locally",
        description: "Module changes will sync automatically when you reconnect.",
      }}
    >
      <ul className="fg-list">
        {modules.map((mod) => (
          <li key={mod.name}>
            <span className="fg-list__primary">{mod.name}</span>
            <span className="fg-list__secondary">{mod.summary}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
