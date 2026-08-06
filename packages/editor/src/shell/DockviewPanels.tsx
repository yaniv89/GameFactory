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
 * still no backend (M5) — persistence is local-only until then.
 */
export function ScenesPanelContainer() {
  const scenes = useProjectStore((state) => state.document.scenes);
  const createScene = useProjectStore((state) => state.createScene);

  const sceneNames = scenes.map((scene) => scene.name);

  return (
    <ScenesPanel
      state={sceneNames.length > 0 ? "populated" : "empty"}
      scenes={sceneNames}
      onCreateScene={createScene}
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

export function InspectorPanelContainer() {
  // No selection model exists yet (Phase 4) — "empty" is the honest state.
  return <InspectorPanel state="empty" />;
}
