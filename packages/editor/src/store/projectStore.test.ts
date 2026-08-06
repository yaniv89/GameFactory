import { beforeEach, describe, expect, it } from "vitest";
import { selectCanRedo, selectCanUndo, useProjectStore } from "./projectStore";

function reset(): void {
  localStorage.clear();
  useProjectStore.setState({ document: { scenes: [] }, past: [], future: [], selectedSceneId: undefined });
}

describe("useProjectStore", () => {
  beforeEach(reset);

  it("starts with no scenes and nothing to undo or redo", () => {
    const state = useProjectStore.getState();
    expect(state.document.scenes).toEqual([]);
    expect(selectCanUndo(state)).toBe(false);
    expect(selectCanRedo(state)).toBe(false);
  });

  it("createScene appends a scene and makes undo available", () => {
    useProjectStore.getState().createScene();
    const state = useProjectStore.getState();
    expect(state.document.scenes).toHaveLength(1);
    expect(state.document.scenes[0]?.name).toBe("Scene 1");
    expect(selectCanUndo(state)).toBe(true);
    expect(selectCanRedo(state)).toBe(false);
  });

  it("assigns each scene a unique id and an incrementing default name", () => {
    useProjectStore.getState().createScene();
    useProjectStore.getState().createScene();
    const { scenes } = useProjectStore.getState().document;
    expect(scenes.map((scene) => scene.name)).toEqual(["Scene 1", "Scene 2"]);
    expect(scenes[0]?.id).not.toBe(scenes[1]?.id);
  });

  it("undo removes the most recently created scene via a command-log entry, not a snapshot restore", () => {
    useProjectStore.getState().createScene();
    useProjectStore.getState().createScene();
    useProjectStore.getState().undo();
    const state = useProjectStore.getState();
    expect(state.document.scenes.map((scene) => scene.name)).toEqual(["Scene 1"]);
    expect(selectCanUndo(state)).toBe(true);
    expect(selectCanRedo(state)).toBe(true);
  });

  it("redo replays the forward command after an undo", () => {
    useProjectStore.getState().createScene();
    useProjectStore.getState().undo();
    useProjectStore.getState().redo();
    const state = useProjectStore.getState();
    expect(state.document.scenes.map((scene) => scene.name)).toEqual(["Scene 1"]);
    expect(selectCanRedo(state)).toBe(false);
  });

  it("dispatching a new command after undo discards the redo branch", () => {
    useProjectStore.getState().createScene();
    useProjectStore.getState().createScene();
    useProjectStore.getState().undo();
    expect(selectCanRedo(useProjectStore.getState())).toBe(true);
    useProjectStore.getState().createScene();
    const state = useProjectStore.getState();
    expect(selectCanRedo(state)).toBe(false);
    expect(state.document.scenes.map((scene) => scene.name)).toEqual(["Scene 1", "Scene 2"]);
  });

  it("undo and redo are no-ops on an empty history rather than throwing", () => {
    expect(() => useProjectStore.getState().undo()).not.toThrow();
    expect(() => useProjectStore.getState().redo()).not.toThrow();
    expect(useProjectStore.getState().document.scenes).toEqual([]);
  });

  it("has no ceiling within a session: undo walks all the way back through many commands", () => {
    for (let i = 0; i < 25; i += 1) useProjectStore.getState().createScene();
    for (let i = 0; i < 25; i += 1) useProjectStore.getState().undo();
    const state = useProjectStore.getState();
    expect(state.document.scenes).toEqual([]);
    expect(selectCanUndo(state)).toBe(false);
    expect(selectCanRedo(state)).toBe(true);
  });

  it("persists the document and history to localStorage so it survives a reload", () => {
    useProjectStore.getState().createScene();
    const raw = localStorage.getItem("forge:editor:project-document");
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string);
    expect(persisted.state.document.scenes).toHaveLength(1);
    expect(persisted.state.past).toHaveLength(1);
  });

  it("selectScene sets and clears the selection without touching the command log", () => {
    useProjectStore.getState().createScene();
    const sceneId = useProjectStore.getState().document.scenes[0]?.id as string;

    useProjectStore.getState().selectScene(sceneId);
    expect(useProjectStore.getState().selectedSceneId).toBe(sceneId);
    expect(selectCanUndo(useProjectStore.getState())).toBe(true);

    useProjectStore.getState().selectScene(undefined);
    expect(useProjectStore.getState().selectedSceneId).toBeUndefined();
  });

  it("does not persist the selection: a fresh session starts with nothing selected", () => {
    useProjectStore.getState().createScene();
    const sceneId = useProjectStore.getState().document.scenes[0]?.id as string;
    useProjectStore.getState().selectScene(sceneId);

    const raw = localStorage.getItem("forge:editor:project-document");
    const persisted = JSON.parse(raw as string);
    expect(persisted.state.selectedSceneId).toBeUndefined();
  });

  it("renameScene dispatches an undoable command that updates only the target scene", () => {
    useProjectStore.getState().createScene();
    useProjectStore.getState().createScene();
    const [first, second] = useProjectStore.getState().document.scenes;

    useProjectStore.getState().renameScene(first!.id, "Village Square");
    const state = useProjectStore.getState();
    expect(state.document.scenes.map((scene) => scene.name)).toEqual(["Village Square", second!.name]);
    expect(selectCanUndo(state)).toBe(true);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().document.scenes.map((scene) => scene.name)).toEqual(["Scene 1", "Scene 2"]);

    useProjectStore.getState().redo();
    expect(useProjectStore.getState().document.scenes.map((scene) => scene.name)).toEqual([
      "Village Square",
      "Scene 2",
    ]);
  });

  it("renameScene to the same name is a no-op that does not grow the undo log", () => {
    useProjectStore.getState().createScene();
    const sceneId = useProjectStore.getState().document.scenes[0]?.id as string;

    useProjectStore.getState().renameScene(sceneId, "Scene 1");
    const state = useProjectStore.getState();
    expect(state.past).toHaveLength(1); // only the original createScene entry
  });
});
