import { Button, Dialog } from "@forge/ds";
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from "dockview-react";
import "dockview/dist/styles/dockview.css";
import "./styles/dockview-theme.css";
import { useState, type FC } from "react";
import { PackSwapDialogContainer } from "./canvas/PackSwapDialogContainer";
import { SceneCanvas } from "./canvas/SceneCanvas";
import { useAuthStore } from "./auth/authStore";
import { PresenceIndicator } from "./collab/PresenceIndicator";
import { useProjectSyncStore, type SyncStatus } from "./project/projectSyncStore";
import { HistoryPanelContainer, InspectorPanelContainer, ModulesPanelContainer, ScenesPanelContainer } from "./shell/DockviewPanels";
import { PreviewPanel } from "./shell/PreviewPanel";
import { UndoRedoControls } from "./shell/UndoRedoControls";
import "./App.css";

const COMPONENTS: Record<string, FC<IDockviewPanelProps>> = {
  scenes: ScenesPanelContainer,
  modules: ModulesPanelContainer,
  inspector: InspectorPanelContainer,
  history: HistoryPanelContainer,
  canvas: SceneCanvas,
  preview: PreviewPanel,
};

function onReady(event: DockviewReadyEvent): void {
  const { api } = event;

  const scenes = api.addPanel({ id: "scenes", component: "scenes", title: "Scenes" });
  api.addPanel({
    id: "modules",
    component: "modules",
    title: "Modules",
    position: { direction: "below", referencePanel: scenes.id },
  });
  const canvas = api.addPanel({
    id: "canvas",
    component: "canvas",
    title: "Canvas",
    position: { direction: "right", referencePanel: scenes.id },
  });
  const inspector = api.addPanel({
    id: "inspector",
    component: "inspector",
    title: "Inspector",
    position: { direction: "right", referencePanel: canvas.id },
  });
  api.addPanel({
    id: "history",
    component: "history",
    title: "History",
    position: { direction: "below", referencePanel: inspector.id },
  });
  api.addPanel({
    id: "preview",
    component: "preview",
    title: "Preview",
    position: { direction: "below", referencePanel: canvas.id },
  });
}

const SAVE_STATUS_LABEL: Partial<Record<SyncStatus, string>> = {
  saving: "Saving…",
  saved: "Saved",
  offline: "Offline — changes stay local until you reconnect",
  error: "Couldn't save",
};

export interface AppProps {
  readonly projectTitle?: string;
  readonly onCloseProject?: () => void;
}

export function App({ projectTitle = "Untitled Project", onCloseProject }: AppProps) {
  const [packSwapOpen, setPackSwapOpen] = useState(false);
  const { projectId, status: syncStatus, error: syncError, conflictActualRevision, saveProject, openProject } = useProjectSyncStore();
  const accessToken = useAuthStore((s) => s.session?.accessToken);

  const statusLabel = SAVE_STATUS_LABEL[syncStatus];

  return (
    <div className="fg-app">
      <header className="fg-app__toolbar">
        <span className="fg-app__title">Forge</span>
        {onCloseProject && (
          <Button variant="secondary" onClick={onCloseProject}>
            My projects
          </Button>
        )}
        <span className="fg-app__project-name">{projectTitle}</span>
        <UndoRedoControls />
        {projectId && (
          <Button variant="primary" onClick={() => void saveProject()} disabled={syncStatus === "saving"}>
            Save
          </Button>
        )}
        {statusLabel && (
          <span className="fg-app__save-status" data-status={syncStatus} role="status">
            {statusLabel}
          </span>
        )}
        {projectId && accessToken && (
          <PresenceIndicator hubUrl={window.location.origin} projectId={projectId} accessToken={accessToken} />
        )}
        <Button variant="secondary" onClick={() => setPackSwapOpen(true)}>
          Swap Art Pack
        </Button>
      </header>
      <div className="fg-app__dock">
        <DockviewReact components={COMPONENTS} onReady={onReady} className="fg-dockview" />
      </div>
      <PackSwapDialogContainer open={packSwapOpen} onClose={() => setPackSwapOpen(false)} />
      <Dialog open={syncStatus === "conflict"} title="This project changed on the server" onClose={() => {}}>
        <p>
          {syncError ?? "Someone else (or another tab) saved a newer revision"}
          {conflictActualRevision !== undefined && ` (revision ${conflictActualRevision})`}. Your unsaved changes are
          still here, but saving them now would silently overwrite that newer revision.
        </p>
        <p>Reloading replaces your local changes with the latest saved version. This cannot be undone.</p>
        <div className="fg-app__conflict-actions">
          <Button
            variant="destructive"
            onClick={() => {
              if (projectId) void openProject(projectId, projectTitle);
            }}
          >
            Discard my changes and reload
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
