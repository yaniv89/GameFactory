import { beforeEach, describe, expect, it } from "vitest";
import { selectCanRedo, selectCanUndo, useProjectStore } from "./projectStore";

function reset(): void {
  localStorage.clear();
  useProjectStore.setState({
    document: { scenes: [], installedModules: {} },
    past: [],
    future: [],
    selection: undefined,
  });
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
    expect(useProjectStore.getState().selection).toEqual({ kind: "scene", sceneId });
    expect(selectCanUndo(useProjectStore.getState())).toBe(true);

    useProjectStore.getState().selectScene(undefined);
    expect(useProjectStore.getState().selection).toBeUndefined();
  });

  it("does not persist the selection: a fresh session starts with nothing selected", () => {
    useProjectStore.getState().createScene();
    const sceneId = useProjectStore.getState().document.scenes[0]?.id as string;
    useProjectStore.getState().selectScene(sceneId);

    const raw = localStorage.getItem("forge:editor:project-document");
    const persisted = JSON.parse(raw as string);
    expect(persisted.state.selection).toBeUndefined();
  });

  it("selecting a module clears a scene selection and vice versa — only one selection at a time", () => {
    useProjectStore.getState().createScene();
    const sceneId = useProjectStore.getState().document.scenes[0]?.id as string;
    useProjectStore.getState().installModule("@forge/inventory", { defaultMaxSlots: 20 });

    useProjectStore.getState().selectScene(sceneId);
    expect(useProjectStore.getState().selection).toEqual({ kind: "scene", sceneId });

    useProjectStore.getState().selectModule("@forge/inventory");
    expect(useProjectStore.getState().selection).toEqual({ kind: "module", moduleName: "@forge/inventory" });
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

  it("installModule adds the module with its initial config and makes undo available", () => {
    useProjectStore.getState().installModule("@forge/turn-battle", { baseHitChance: 0.9 });
    const state = useProjectStore.getState();
    expect(state.document.installedModules["@forge/turn-battle"]).toEqual({ baseHitChance: 0.9 });
    expect(selectCanUndo(state)).toBe(true);
  });

  it("installModule on an already-installed module is a no-op that does not grow the undo log", () => {
    useProjectStore.getState().installModule("@forge/turn-battle", { baseHitChance: 0.9 });
    useProjectStore.getState().installModule("@forge/turn-battle", { baseHitChance: 0.1 });
    const state = useProjectStore.getState();
    expect(state.document.installedModules["@forge/turn-battle"]).toEqual({ baseHitChance: 0.9 });
    expect(state.past).toHaveLength(1);
  });

  it("uninstallModule removes it, and undo restores it with its exact prior config", () => {
    useProjectStore.getState().installModule("@forge/turn-battle", { baseHitChance: 0.9 });
    useProjectStore.getState().configureModule("@forge/turn-battle", { baseHitChance: 0.75 });

    useProjectStore.getState().uninstallModule("@forge/turn-battle");
    expect(useProjectStore.getState().document.installedModules["@forge/turn-battle"]).toBeUndefined();

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().document.installedModules["@forge/turn-battle"]).toEqual({
      baseHitChance: 0.75,
    });
  });

  it("uninstallModule on a module that isn't installed is a no-op that does not grow the undo log", () => {
    useProjectStore.getState().uninstallModule("@forge/turn-battle");
    expect(useProjectStore.getState().past).toHaveLength(0);
  });

  it("uninstallModule clears the selection if the uninstalled module was selected", () => {
    useProjectStore.getState().installModule("@forge/turn-battle", { baseHitChance: 0.9 });
    useProjectStore.getState().selectModule("@forge/turn-battle");
    useProjectStore.getState().uninstallModule("@forge/turn-battle");
    expect(useProjectStore.getState().selection).toBeUndefined();
  });

  it("configureModule dispatches an undoable command that updates only that module's config", () => {
    useProjectStore.getState().installModule("@forge/turn-battle", { baseHitChance: 0.9 });
    useProjectStore.getState().installModule("@forge/inventory", { defaultMaxSlots: 20 });

    useProjectStore.getState().configureModule("@forge/turn-battle", { baseHitChance: 0.5 });
    const state = useProjectStore.getState();
    expect(state.document.installedModules["@forge/turn-battle"]).toEqual({ baseHitChance: 0.5 });
    expect(state.document.installedModules["@forge/inventory"]).toEqual({ defaultMaxSlots: 20 });

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().document.installedModules["@forge/turn-battle"]).toEqual({
      baseHitChance: 0.9,
    });
  });

  it("configureModule on a module that isn't installed is a no-op", () => {
    useProjectStore.getState().configureModule("@forge/turn-battle", { baseHitChance: 0.5 });
    const state = useProjectStore.getState();
    expect(state.document.installedModules["@forge/turn-battle"]).toBeUndefined();
    expect(state.past).toHaveLength(0);
  });

  it("configureModule with unchanged values is a no-op that does not grow the undo log", () => {
    useProjectStore.getState().installModule("@forge/turn-battle", { baseHitChance: 0.9 });
    useProjectStore.getState().configureModule("@forge/turn-battle", { baseHitChance: 0.9 });
    expect(useProjectStore.getState().past).toHaveLength(1);
  });
});
