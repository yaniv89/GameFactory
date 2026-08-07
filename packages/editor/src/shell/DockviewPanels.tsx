import { EntityInspector } from "../inspector/EntityInspector";
import { defaultsFromSchema } from "../inspector/jsonSchema";
import { ModuleInspector } from "../inspector/ModuleInspector";
import { SceneInspector } from "../inspector/SceneInspector";
import { FIRST_PARTY_MODULE_MANIFESTS } from "../modules/moduleManifests";
import { InspectorPanel } from "../panels/InspectorPanel";
import { ModulesPanel } from "../panels/ModulesPanel";
import { ScenesPanel } from "../panels/ScenesPanel";
import { useProjectStore } from "../store/projectStore";

/**
 * Scene creation now goes through the command-log undo store (Phase 3):
 * every click dispatches a real, undoable "scene/create" command and the
 * document persists to localStorage, so it survives a reload. There is
 * still no backend (M5) — persistence is local-only until then. Selecting
 * a scene (Phase 4) feeds the Inspector via the store's selection.
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

/**
 * The module catalog (`moduleManifests.ts`) is always all three
 * first-party modules — there's no registry to add or remove entries from
 * yet (M6/M7) — but which ones are installed, and their config, is now
 * real project-document state (Phase 5). Install/uninstall/configure are
 * all undoable through the same command log as scenes.
 */
export function ModulesPanelContainer() {
  const installedModules = useProjectStore((state) => state.document.installedModules);
  const installModule = useProjectStore((state) => state.installModule);
  const uninstallModule = useProjectStore((state) => state.uninstallModule);
  const selectModule = useProjectStore((state) => state.selectModule);

  const modules = FIRST_PARTY_MODULE_MANIFESTS.map((manifest) => ({
    name: manifest.name,
    summary: manifest.summary,
    installed: manifest.name in installedModules,
    configurable: manifest.configSchema !== undefined,
  }));

  return (
    <ModulesPanel
      state="populated"
      modules={modules}
      onInstall={(name) => {
        const manifest = FIRST_PARTY_MODULE_MANIFESTS.find((candidate) => candidate.name === name);
        const initialConfig = manifest?.configSchema ? defaultsFromSchema(manifest.configSchema) : {};
        installModule(name, initialConfig);
      }}
      onUninstall={uninstallModule}
      onConfigure={selectModule}
      onBrowseMarketplace={() => {
        // The marketplace (M6/M7) doesn't exist yet — logged rather than silently doing nothing.
        console.info("[forge:editor] marketplace browsing lands in M6/M7");
      }}
    />
  );
}

/**
 * Renders the JSON-Schema-driven inspector for whatever's selected — a
 * scene (Phase 4), an installed module (Phase 5), or, as of Phase 7, an
 * entity placed on the canvas (a player start or an NPC's one-line
 * dialogue). If the selection points at something that no longer
 * exists — e.g. its creation/install/placement was undone while it was
 * selected, or it was removed elsewhere — "empty" is still the honest
 * state, not a crash or a stale form.
 */
export function InspectorPanelContainer() {
  const scenes = useProjectStore((state) => state.document.scenes);
  const installedModules = useProjectStore((state) => state.document.installedModules);
  const selection = useProjectStore((state) => state.selection);
  const renameScene = useProjectStore((state) => state.renameScene);
  const configureModule = useProjectStore((state) => state.configureModule);
  const configureEntityDialogue = useProjectStore((state) => state.configureEntityDialogue);
  const removeEntity = useProjectStore((state) => state.removeEntity);

  if (selection?.kind === "scene") {
    const scene = scenes.find((candidate) => candidate.id === selection.sceneId);
    if (scene) {
      return (
        <InspectorPanel state="populated" selectionLabel={`Scene: ${scene.name}`}>
          <SceneInspector scene={scene} onRename={renameScene} />
        </InspectorPanel>
      );
    }
  }

  if (selection?.kind === "module") {
    const manifest = FIRST_PARTY_MODULE_MANIFESTS.find((candidate) => candidate.name === selection.moduleName);
    const config = installedModules[selection.moduleName];
    if (manifest && config) {
      return (
        <InspectorPanel state="populated" selectionLabel={`Module: ${manifest.name}`}>
          <ModuleInspector manifest={manifest} config={config} onConfigure={configureModule} />
        </InspectorPanel>
      );
    }
  }

  if (selection?.kind === "entity") {
    const scene = scenes.find((candidate) => candidate.id === selection.sceneId);
    const entity = scene?.entities.find((candidate) => candidate.id === selection.entityId);
    if (entity) {
      const label = entity.kind === "npc" ? "NPC" : "Player start";
      return (
        <InspectorPanel state="populated" selectionLabel={label}>
          <EntityInspector
            entity={entity}
            onConfigureDialogue={(entityId, dialogue) => configureEntityDialogue(selection.sceneId, entityId, dialogue)}
            onRemove={(entityId) => removeEntity(selection.sceneId, entityId)}
          />
        </InspectorPanel>
      );
    }
  }

  return <InspectorPanel state="empty" />;
}
