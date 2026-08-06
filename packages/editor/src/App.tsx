import { DockviewReact, type DockviewReadyEvent, type IDockviewPanelProps } from "dockview-react";
import "dockview/dist/styles/dockview.css";
import "./styles/dockview-theme.css";
import type { FC } from "react";
import { CanvasPlaceholder } from "./shell/CanvasPlaceholder";
import { InspectorPanelContainer, ModulesPanelContainer, ScenesPanelContainer } from "./shell/DockviewPanels";
import "./App.css";

const COMPONENTS: Record<string, FC<IDockviewPanelProps>> = {
  scenes: ScenesPanelContainer,
  modules: ModulesPanelContainer,
  inspector: InspectorPanelContainer,
  canvas: CanvasPlaceholder,
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
}

export function App() {
  return (
    <div className="fg-app">
      <header className="fg-app__toolbar">
        <span className="fg-app__title">Forge</span>
        <span className="fg-app__project-name">Untitled Project</span>
      </header>
      <div className="fg-app__dock">
        <DockviewReact components={COMPONENTS} onReady={onReady} className="fg-dockview" />
      </div>
    </div>
  );
}
