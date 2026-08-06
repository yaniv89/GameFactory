import { SceneInspector } from "../inspector/SceneInspector";
import { InspectorPanel } from "../panels/InspectorPanel";
import { ModulesPanel, type ModuleSummary } from "../panels/ModulesPanel";
import { ScenesPanel } from "../panels/ScenesPanel";
import { useProjectStore } from "../store/projectStore";

/**
 * Real modules built in M3 (packages/modules/dialogue|inventory|turn-battle) —
 * this list is bundle-time-known fact, not placeholder data. The registry
 * (M6) replaces this with a real installed-modules query; until then this
 * IS what's installed, since these three ship with the platform.
 */
const FIRST_PARTY_MODULES: readonly ModuleSummary[] = [
  { name: "@forge/dialogue", summary: "Dialogue trees with translatable, filterable lines." },
  { name: "@forge/inventory", summary: "Per-entity item stacks, capacity limits, and a shop flow." },
  { name: "@forge/turn-battle", summary: "1v1 turn-based combat with hit chance and damage filters." },
];

/**
 * Scene creation now goes through the command-log undo store (Phase 3):
 * every click dispatches a real, undoable "scene/create" command and the
 * document persists to localStorage, so it survives a reload. There is
 * still no backend (M5) — persistence is local-only until then. Selecting
 * a scene (Phase 4) feeds the Inspector via the store's selectedSceneId.
 */
export function ScenesPanelContainer() {
  const scenes = useProjectStore((state) => state.document.scenes);
  const createScene = useProjectStore((state) => state.createScene);
  const selectScene = useProjectStore((state) => state.selectScene);

  return (
    <ScenesPanel
      state={scenes.length > 0 ? "populated" : "empty"}
      scenes={scenes}
      onCreateScene={createScene}
      onSelectScene={selectScene}
    />
  );
}

export function ModulesPanelContainer() {
  return (
    <ModulesPanel
      state="populated"
      modules={FIRST_PARTY_MODULES}
      onBrowseMarketplace={() => {
        // The marketplace (M6/M7) doesn't exist yet — logged rather than silently doing nothing.
        console.info("[forge:editor] marketplace browsing lands in M6/M7");
      }}
    />
  );
}

/**
 * Renders the JSON-Schema-driven SceneInspector for the selected scene
 * (Phase 4). If the selection points at a scene that no longer exists —
 * e.g. its creation was undone while it was selected — "empty" is still
 * the honest state, not a crash or a stale form.
 */
export function InspectorPanelContainer() {
  const scenes = useProjectStore((state) => state.document.scenes);
  const selectedSceneId = useProjectStore((state) => state.selectedSceneId);
  const renameScene = useProjectStore((state) => state.renameScene);

  const selectedScene = scenes.find((scene) => scene.id === selectedSceneId);

  if (!selectedScene) {
    return <InspectorPanel state="empty" />;
  }

  return (
    <InspectorPanel state="populated" selectionLabel={`Scene: ${selectedScene.name}`}>
      <SceneInspector scene={selectedScene} onRename={renameScene} />
    </InspectorPanel>
  );
}
