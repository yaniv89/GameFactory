import { Panel, type ViewState } from "@forge/ds";

export interface ScenesPanelProps {
  state: ViewState;
  scenes?: readonly string[];
  onCreateScene: () => void;
  onRetry?: () => void;
}

/**
 * Pure presentational component — no dockview types, no data fetching —
 * so it's independently testable and storyable per CLAUDE.md 5.4. See
 * ScenesPanelContainer for the dockview-shaped wrapper that supplies
 * real (if still Phase-1-scoped) state.
 */
export function ScenesPanel({ state, scenes = [], onCreateScene, onRetry }: ScenesPanelProps) {
  return (
    <Panel
      title="Scenes"
      state={state}
      empty={{
        title: "No scenes yet",
        description: "A scene is one map, menu, or battle screen. Most games start with a town or a starting room.",
        actionLabel: "Create a scene",
        onAction: onCreateScene,
      }}
      error={{
        title: "Couldn't load scenes",
        description: "The request timed out. Your connection may be slow or the project may be very large.",
        onRetry: onRetry ?? (() => {}),
      }}
      permissionDenied={{
        title: "You have view access to this project",
        description: "Ask the project owner for editor access to make changes.",
      }}
      offline={{
        title: "Offline — changes stored locally",
        description: "Scenes will sync automatically when you reconnect.",
      }}
    >
      <ul className="fg-list">
        {scenes.map((scene) => (
          <li key={scene}>{scene}</li>
        ))}
      </ul>
    </Panel>
  );
}
