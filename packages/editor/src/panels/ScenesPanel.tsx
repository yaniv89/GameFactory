import { Panel, Tree, type ViewState } from "@forge/ds";

export interface ScenesPanelSceneNode {
  readonly id: string;
  readonly name: string;
}

export interface ScenesPanelProps {
  state: ViewState;
  scenes?: readonly ScenesPanelSceneNode[];
  onCreateScene: () => void;
  onSelectScene?: (sceneId: string) => void;
  onRetry?: () => void;
}

/**
 * Pure presentational component — no dockview types, no data fetching —
 * so it's independently testable and storyable per CLAUDE.md 5.4. See
 * ScenesPanelContainer for the dockview-shaped wrapper that supplies
 * real state from the project store.
 *
 * The scene list is a Tree (not a flat <ul>) so it doubles as the
 * keyboard/screen-reader parallel of the canvas CLAUDE.md 5.6 requires:
 * arrow-key navigation and selection work here today, and it is the
 * natural place for per-scene entity hierarchies to nest once scenes have
 * contents to show (M4 Phase 6+).
 */
export function ScenesPanel({ state, scenes = [], onCreateScene, onSelectScene, onRetry }: ScenesPanelProps) {
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
      <Tree
        label="Scenes"
        state="populated"
        nodes={scenes.map((scene) => ({ id: scene.id, label: scene.name }))}
        onSelect={onSelectScene ?? (() => {})}
      />
    </Panel>
  );
}
