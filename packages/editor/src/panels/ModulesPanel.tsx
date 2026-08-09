import { Button, Panel, type ViewState } from "@forge/ds";

export interface ModuleSummary {
  readonly name: string;
  readonly summary: string;
  readonly installed: boolean;
  /** Whether the module declares a `configSchema` — gates showing a "Configure" action. */
  readonly configurable: boolean;
}

export interface ModulesPanelProps {
  state: ViewState;
  modules?: readonly ModuleSummary[];
  onInstall: (name: string) => void;
  onUninstall: (name: string) => void;
  onConfigure?: (name: string) => void;
  onBrowseMarketplace: () => void;
  onRetry?: () => void;
}

/**
 * The full module catalog available to this project — today, that's
 * exactly the three first-party modules (`packages/modules/*`), since
 * there is no registry to browse yet (M6/M7). Each row can be installed,
 * uninstalled, or (if it declares a `configSchema`) sent to the Inspector
 * to configure — all real, undoable project-document operations
 * (projectStore's `installModule`/`uninstallModule`/`selectModule`).
 */
export function ModulesPanel({
  state,
  modules = [],
  onInstall,
  onUninstall,
  onConfigure,
  onBrowseMarketplace,
  onRetry,
}: ModulesPanelProps) {
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
          <li key={mod.name} className="fg-modules-list__row">
            <div>
              <span className="fg-list__primary">{mod.name}</span>
              <span className="fg-list__secondary">{mod.summary}</span>
            </div>
            <div className="fg-modules-list__actions">
              {mod.installed && mod.configurable && (
                <Button variant="secondary" onClick={() => onConfigure?.(mod.name)}>
                  Configure
                </Button>
              )}
              {mod.installed ? (
                <Button variant="destructive" onClick={() => onUninstall(mod.name)}>
                  Uninstall
                </Button>
              ) : (
                <Button variant="primary" onClick={() => onInstall(mod.name)}>
                  Install
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
