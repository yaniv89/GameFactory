import { Button } from "@forge/ds";
import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from "dockview-react";
import "dockview/dist/styles/dockview.css";
import "./styles/dockview-theme.css";
import { useState, type FC } from "react";
import { PackSwapDialogContainer } from "./canvas/PackSwapDialogContainer";
import { SceneCanvas } from "./canvas/SceneCanvas";
import { InspectorPanelContainer, ModulesPanelContainer, ScenesPanelContainer } from "./shell/DockviewPanels";
import { PreviewPanel } from "./shell/PreviewPanel";
import { UndoRedoControls } from "./shell/UndoRedoControls";
import "./App.css";

const COMPONENTS: Record<string, FC<IDockviewPanelProps>> = {
  scenes: ScenesPanelContainer,
  modules: ModulesPanelContainer,
  inspector: InspectorPanelContainer,
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
  api.addPanel({
    id: "inspector",
    component: "inspector",
    title: "Inspector",
    position: { direction: "right", referencePanel: canvas.id },
  });
  api.addPanel({
    id: "preview",
    component: "preview",
    title: "Preview",
    position: { direction: "below", referencePanel: canvas.id },
  });
}

export function App() {
  const [packSwapOpen, setPackSwapOpen] = useState(false);

  return (
    <div className="fg-app">
      <header className="fg-app__toolbar">
        <span className="fg-app__title">Forge</span>
        <span className="fg-app__project-name">Untitled Project</span>
        <UndoRedoControls />
        <Button variant="secondary" onClick={() => setPackSwapOpen(true)}>
          Swap Art Pack
        </Button>
      </header>
      <div className="fg-app__dock">
        <DockviewReact components={COMPONENTS} onReady={onReady} className="fg-dockview" />
      </div>
      <PackSwapDialogContainer open={packSwapOpen} onClose={() => setPackSwapOpen(false)} />
    </div>
  );
}
