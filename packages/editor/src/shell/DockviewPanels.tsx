import { useState } from "react";
import { InspectorPanel } from "../panels/InspectorPanel";
import { ModulesPanel, type ModuleSummary } from "../panels/ModulesPanel";
import { ScenesPanel } from "../panels/ScenesPanel";

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
 * Phase 1 scope: scene creation is real, in-memory, local component state —
 * not yet wired to the command-log undo store (Phase 3) or any backend
 * (M5), and does not survive a reload. That wiring is later phases' job;
 * this proves the panel/Dockview integration with genuine (if temporary)
 * interactivity rather than a dead button.
 */
export function ScenesPanelContainer() {
  const [scenes, setScenes] = useState<string[]>([]);

  const onCreateScene = () => {
    setScenes((prev) => [...prev, `scene-${prev.length + 1}`]);
  };

  return <ScenesPanel state={scenes.length > 0 ? "populated" : "empty"} scenes={scenes} onCreateScene={onCreateScene} />;
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
