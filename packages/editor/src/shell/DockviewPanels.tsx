import { Button, Dialog } from "@forge/ds";
import { getPrefab } from "@forge/core";
import { useEffect, useState } from "react";
import { EntityInspector } from "../inspector/EntityInspector";
import { defaultsFromSchema } from "../inspector/jsonSchema";
import { ModuleInspector } from "../inspector/ModuleInspector";
import { SceneInspector } from "../inspector/SceneInspector";
import { FIRST_PARTY_MODULE_MANIFESTS, type ModuleManifest } from "../modules/moduleManifests";
import { GraphEditorDialog } from "../graph/GraphEditorDialog";
import { GraphsPanel } from "../panels/GraphsPanel";
import { HistoryPanel } from "../panels/HistoryPanel";
import { InspectorPanel } from "../panels/InspectorPanel";
import { ModulesPanel } from "../panels/ModulesPanel";
import { QuestsPanel } from "../panels/QuestsPanel";
import { ScenesPanel } from "../panels/ScenesPanel";
import { useMarketplaceStore } from "../project/marketplaceStore";
import { useProjectSyncStore } from "../project/projectSyncStore";
import { useRevisionHistoryStore } from "../project/revisionHistoryStore";
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
 * The module catalog a project can install *into itself* from this panel
 * (`ModulesPanel`'s own "Install" action) is still always exactly the
 * three first-party modules — a marketplace package installs through the
 * Marketplace dialog's own "Install" action instead (its manifest/version/
 * bundle URL come from a real backend eligibility check, not this panel's
 * static list). But which modules are installed, first-party or
 * marketplace, and their config, is all real project-document state, and
 * this panel is the one place both kinds show up together — resolved via
 * `resolveInstalledModuleManifest` below. Install/uninstall/configure are
 * all undoable through the same command log as scenes.
 *
 * "Browse the marketplace" (G2) opens the real dialog where a marketplace
 * install actually happens; this panel only reflects the result.
 */

/**
 * A `ModuleManifest` for any installed module, first-party or marketplace
 * — checks the static first-party list first, then `marketplaceStore`'s
 * install-time cache, falling back to a plain-name/no-schema manifest for
 * a marketplace module installed in an earlier session whose package page
 * hasn't been reopened yet in this one (an honest degraded state: its name
 * and Uninstall action still work, it just shows no summary and isn't
 * configurable until its manifest is seen again).
 */
function resolveInstalledModuleManifest(name: string, marketplaceManifests: Readonly<Record<string, ModuleManifest>>): ModuleManifest {
  return (
    FIRST_PARTY_MODULE_MANIFESTS.find((candidate) => candidate.name === name) ??
    marketplaceManifests[name] ?? { name, summary: name }
  );
}

export function ModulesPanelContainer() {
  const installedModules = useProjectStore((state) => state.document.installedModules);
  const installModule = useProjectStore((state) => state.installModule);
  const uninstallModule = useProjectStore((state) => state.uninstallModule);
  const selectModule = useProjectStore((state) => state.selectModule);
  const openMarketplace = useMarketplaceStore((state) => state.open);
  const marketplaceManifests = useMarketplaceStore((state) => state.installedManifests);

  const installedNames = Object.keys(installedModules);
  const marketplaceOnlyNames = installedNames.filter(
    (name) => !FIRST_PARTY_MODULE_MANIFESTS.some((candidate) => candidate.name === name),
  );

  const modules = [...FIRST_PARTY_MODULE_MANIFESTS, ...marketplaceOnlyNames.map((name) => resolveInstalledModuleManifest(name, marketplaceManifests))].map(
    (manifest) => ({
      name: manifest.name,
      summary: manifest.summary,
      installed: manifest.name in installedModules,
      configurable: manifest.configSchema !== undefined,
    }),
  );

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
      onBrowseMarketplace={openMarketplace}
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
  const marketplaceManifests = useMarketplaceStore((state) => state.installedManifests);

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
    const entry = installedModules[selection.moduleName];
    if (entry) {
      const manifest = resolveInstalledModuleManifest(selection.moduleName, marketplaceManifests);
      return (
        <InspectorPanel state="populated" selectionLabel={`Module: ${manifest.name}`}>
          <ModuleInspector manifest={manifest} config={entry.config} onConfigure={configureModule} />
        </InspectorPanel>
      );
    }
  }

  if (selection?.kind === "entity") {
    const scene = scenes.find((candidate) => candidate.id === selection.sceneId);
    const entity = scene?.entities.find((candidate) => candidate.id === selection.entityId);
    if (entity) {
      const label = getPrefab(entity.prefabId)?.label ?? entity.prefabId;
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

/**
 * Wires `HistoryPanel` to `revisionHistoryStore` (the paginated list) and
 * `projectSyncStore` (restoring, and reloading the canvas from the new
 * head afterward). Owns the confirm-before-restore `Dialog`: restoring
 * replaces whatever's on the canvas, including any local edits since the
 * last save that no revision captured — that loss isn't undoable within
 * the app the way most edits here are, so CLAUDE.md 5.3's "undoable or
 * confirmed, never both" calls for a confirmation, the same reasoning
 * behind `App.tsx`'s existing conflict dialog.
 *
 * A restore's own success/conflict/error path reuses `projectSyncStore`'s
 * shared sync status rather than inventing a parallel one: a 409 conflict
 * gets `App.tsx`'s existing "This project changed on the server" dialog
 * for free (a restore is exactly the same kind of write CommitRevision is,
 * so the same conflict UX applies unchanged), and a plain failure surfaces
 * through the same toolbar status pill Save already uses. That pill's
 * copy ("Couldn't save") is a known, minor imprecision for a failed
 * restore specifically — accepted rather than forking the status field
 * just to rename one label.
 */
export function HistoryPanelContainer() {
  const projectId = useProjectSyncStore((state) => state.projectId);
  const headRevision = useProjectSyncStore((state) => state.headRevision);
  const syncStatus = useProjectSyncStore((state) => state.status);
  const restoreProjectRevision = useProjectSyncStore((state) => state.restoreRevision);
  const saveProject = useProjectSyncStore((state) => state.saveProject);

  const { status, revisions, nextCursor, loadingMore, load, loadMore } = useRevisionHistoryStore();
  const [pendingRevisionId, setPendingRevisionId] = useState<number | undefined>(undefined);
  const [restoringId, setRestoringId] = useState<number | undefined>(undefined);

  // Re-fetches on every headRevision change, not just the initial project
  // open: dockview keeps this panel mounted even while its tab is hidden,
  // so there's no per-focus remount to hang a reload off of, and
  // headRevision is exactly the signal that means "the history actually
  // has something new" — it advances on every successful Save from the
  // toolbar as well as every successful restore, so this one effect covers
  // both without a separate save-specific listener.
  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId, headRevision, load]);

  useEffect(() => {
    if (restoringId === undefined) return;
    if (syncStatus === "saved" || syncStatus === "conflict" || syncStatus === "error" || syncStatus === "offline") {
      setRestoringId(undefined);
    }
  }, [syncStatus, restoringId]);

  return (
    <>
      <HistoryPanel
        state={status}
        revisions={revisions.map((revision) => ({
          id: revision.id,
          label: revision.label,
          isCheckpoint: revision.isCheckpoint,
          createdAt: revision.createdAt,
          isCurrent: revision.id === headRevision,
        }))}
        hasMore={nextCursor !== undefined}
        loadingMore={loadingMore}
        restoringId={restoringId}
        onRetry={() => projectId && void load(projectId)}
        onLoadMore={() => void loadMore()}
        onRestore={setPendingRevisionId}
        onSaveNow={() => void saveProject()}
      />
      <Dialog
        open={pendingRevisionId !== undefined}
        title="Restore this version?"
        onClose={() => setPendingRevisionId(undefined)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setPendingRevisionId(undefined)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (pendingRevisionId === undefined) return;
                setRestoringId(pendingRevisionId);
                void restoreProjectRevision(pendingRevisionId);
                setPendingRevisionId(undefined);
              }}
            >
              Restore
            </Button>
          </>
        }
      >
        <p>
          This replaces everything on the canvas with revision {pendingRevisionId}. Nothing already saved is lost —
          restoring adds a new save on top of the history, it doesn&apos;t erase anything — but any changes since your
          last save that aren&apos;t in the history will be gone.
        </p>
      </Dialog>
    </>
  );
}

/**
 * docs/adr/0017 / J1 (M3): CRUD over `document.graphs`, all undoable
 * through the same command log as scenes and modules. "Open" sets
 * `openGraphId`, which `GraphEditorDialogContainer` (rendered as a
 * sibling of the dockview tree in `App.tsx`, the same "Dialog for a
 * focused editing session" shape `PackSwapDialogContainer` already uses)
 * subscribes to independently — a dockview panel has no direct prop
 * channel to a sibling dialog, so this goes through the store the same
 * way `MarketplaceDialogContainer`'s own open/close state already does.
 */
export function GraphsPanelContainer() {
  const graphs = useProjectStore((state) => state.document.graphs);
  const createGraph = useProjectStore((state) => state.createGraph);
  const renameGraph = useProjectStore((state) => state.renameGraph);
  const deleteGraph = useProjectStore((state) => state.deleteGraph);
  const openGraphEditor = useProjectStore((state) => state.openGraphEditor);

  const summaries = Object.values(graphs).map((graph) => ({ id: graph.id, name: graph.name, nodeCount: graph.nodes.length }));

  return (
    <GraphsPanel
      state={summaries.length > 0 ? "populated" : "empty"}
      graphs={summaries}
      onCreateGraph={createGraph}
      onRenameGraph={renameGraph}
      onOpenGraph={openGraphEditor}
      onDeleteGraph={deleteGraph}
    />
  );
}

/**
 * docs/adr/0018 Decision 1 (M8): CRUD over `document.quests`, all undoable
 * through the same command log as scenes/modules/graphs. Unlike
 * `GraphsPanelContainer`, there is no dialog counterpart — a quest's
 * *logic* is authored through the unchanged `GraphsPanelContainer`/
 * `GraphEditorDialogContainer` pair above, referencing this panel's own
 * quest/objective ids by hand, not through a second editing surface.
 */
export function QuestsPanelContainer() {
  const quests = useProjectStore((state) => state.document.quests);
  const createQuest = useProjectStore((state) => state.createQuest);
  const editQuest = useProjectStore((state) => state.editQuest);
  const deleteQuest = useProjectStore((state) => state.deleteQuest);
  const addObjective = useProjectStore((state) => state.addObjective);
  const editObjective = useProjectStore((state) => state.editObjective);
  const removeObjective = useProjectStore((state) => state.removeObjective);

  const summaries = Object.values(quests);

  return (
    <QuestsPanel
      state={summaries.length > 0 ? "populated" : "empty"}
      quests={summaries}
      onCreateQuest={createQuest}
      onEditQuest={editQuest}
      onDeleteQuest={deleteQuest}
      onAddObjective={addObjective}
      onEditObjective={editObjective}
      onRemoveObjective={removeObjective}
    />
  );
}

/** The Dialog counterpart of `GraphsPanelContainer`'s "Open" action — see its own doc comment for why this lives at the App.tsx sibling level rather than inside the dockview tree. */
export function GraphEditorDialogContainer() {
  const openGraphId = useProjectStore((state) => state.openGraphId);
  const graph = useProjectStore((state) => (state.openGraphId ? state.document.graphs[state.openGraphId] : undefined));
  const closeGraphEditor = useProjectStore((state) => state.closeGraphEditor);
  const renameGraph = useProjectStore((state) => state.renameGraph);
  const addGraphNode = useProjectStore((state) => state.addGraphNode);
  const moveGraphNode = useProjectStore((state) => state.moveGraphNode);
  const configureGraphNode = useProjectStore((state) => state.configureGraphNode);
  const removeGraphNode = useProjectStore((state) => state.removeGraphNode);
  const addGraphEdge = useProjectStore((state) => state.addGraphEdge);
  const removeGraphEdge = useProjectStore((state) => state.removeGraphEdge);

  if (!openGraphId || !graph) return null;

  return (
    <GraphEditorDialog
      open
      onClose={closeGraphEditor}
      graphName={graph.name}
      nodes={graph.nodes}
      edges={graph.edges}
      onRenameGraph={(name) => renameGraph(openGraphId, name)}
      onAddNode={(type, position, config) => addGraphNode(openGraphId, type, position, config)}
      onMoveNode={(nodeId, position) => moveGraphNode(openGraphId, nodeId, position)}
      onConfigureNode={(nodeId, config) => configureGraphNode(openGraphId, nodeId, config)}
      onRemoveNode={(nodeId) => removeGraphNode(openGraphId, nodeId)}
      onAddEdge={(edge) => addGraphEdge(openGraphId, edge)}
      onRemoveEdge={(edgeId) => removeGraphEdge(openGraphId, edgeId)}
    />
  );
}
