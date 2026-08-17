import { beforeEach, describe, expect, it } from "vitest";
import { migratePersistedProjectState, selectCanRedo, selectCanUndo, useProjectStore } from "./projectStore";

function reset(): void {
  localStorage.clear();
  useProjectStore.setState({
    document: { scenes: [], installedModules: {}, activePack: undefined, packOverrides: {}, packTerrainRemap: {} },
    past: [],
    future: [],
    checkpoints: [],
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
    expect(state.document.installedModules["@forge/turn-battle"]).toEqual({ config: { baseHitChance: 0.9 } });
    expect(selectCanUndo(state)).toBe(true);
  });

  it("installModule on an already-installed module is a no-op that does not grow the undo log", () => {
    useProjectStore.getState().installModule("@forge/turn-battle", { baseHitChance: 0.9 });
    useProjectStore.getState().installModule("@forge/turn-battle", { baseHitChance: 0.1 });
    const state = useProjectStore.getState();
    expect(state.document.installedModules["@forge/turn-battle"]).toEqual({ config: { baseHitChance: 0.9 } });
    expect(state.past).toHaveLength(1);
  });

  it("installModule records a marketplace pin (version + bundle URL), preserved across configureModule/undo", () => {
    useProjectStore
      .getState()
      .installModule("@acme/loot-tables", { dropRate: 0.2 }, { version: "1.2.0", bundleUrl: "https://cdn.forge.dev/loot.js", bundleSha256Hex: "abc123" });
    expect(useProjectStore.getState().document.installedModules["@acme/loot-tables"]).toEqual({
      config: { dropRate: 0.2 },
      marketplace: { version: "1.2.0", bundleUrl: "https://cdn.forge.dev/loot.js", bundleSha256Hex: "abc123" },
    });

    useProjectStore.getState().configureModule("@acme/loot-tables", { dropRate: 0.4 });
    expect(useProjectStore.getState().document.installedModules["@acme/loot-tables"]).toEqual({
      config: { dropRate: 0.4 },
      marketplace: { version: "1.2.0", bundleUrl: "https://cdn.forge.dev/loot.js", bundleSha256Hex: "abc123" },
    });

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().document.installedModules["@acme/loot-tables"]).toEqual({
      config: { dropRate: 0.2 },
      marketplace: { version: "1.2.0", bundleUrl: "https://cdn.forge.dev/loot.js", bundleSha256Hex: "abc123" },
    });
  });

  it("uninstallModule removes it, and undo restores it with its exact prior config", () => {
    useProjectStore.getState().installModule("@forge/turn-battle", { baseHitChance: 0.9 });
    useProjectStore.getState().configureModule("@forge/turn-battle", { baseHitChance: 0.75 });

    useProjectStore.getState().uninstallModule("@forge/turn-battle");
    expect(useProjectStore.getState().document.installedModules["@forge/turn-battle"]).toBeUndefined();

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().document.installedModules["@forge/turn-battle"]).toEqual({
      config: { baseHitChance: 0.75 },
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
    expect(state.document.installedModules["@forge/turn-battle"]).toEqual({ config: { baseHitChance: 0.5 } });
    expect(state.document.installedModules["@forge/inventory"]).toEqual({ config: { defaultMaxSlots: 20 } });

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().document.installedModules["@forge/turn-battle"]).toEqual({
      config: { baseHitChance: 0.9 },
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

  it("setActivePack sets the active pack and undo clears it via a command-log entry", () => {
    useProjectStore.getState().setActivePack("@pixelfoundry/fantasy-pack");
    expect(useProjectStore.getState().document.activePack).toBe("@pixelfoundry/fantasy-pack");
    expect(selectCanUndo(useProjectStore.getState())).toBe(true);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().document.activePack).toBeUndefined();
  });

  it("setActivePack from one pack to another restores the prior pack on undo", () => {
    useProjectStore.getState().setActivePack("@pixelfoundry/fantasy-pack");
    useProjectStore.getState().setActivePack("@moonlit/scifi-pack");
    expect(useProjectStore.getState().document.activePack).toBe("@moonlit/scifi-pack");

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().document.activePack).toBe("@pixelfoundry/fantasy-pack");
  });

  it("setActivePack with the same pack already active is a no-op that does not grow the undo log", () => {
    useProjectStore.getState().setActivePack("@pixelfoundry/fantasy-pack");
    useProjectStore.getState().setActivePack("@pixelfoundry/fantasy-pack");
    expect(useProjectStore.getState().past).toHaveLength(1);
  });

  it("setPackOverride sets an override and undo removes the key entirely, not just clears its value", () => {
    useProjectStore.getState().setPackOverride("tilesets/outdoor-base.png", "https://cdn.forge.dev/overrides/mine.png");
    expect(useProjectStore.getState().document.packOverrides).toEqual({
      "tilesets/outdoor-base.png": "https://cdn.forge.dev/overrides/mine.png",
    });

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().document.packOverrides).toEqual({});
    expect("tilesets/outdoor-base.png" in useProjectStore.getState().document.packOverrides).toBe(false);
  });

  it("setPackOverride with undefined clears an existing override and undo restores it", () => {
    useProjectStore.getState().setPackOverride("tilesets/outdoor-base.png", "https://cdn.forge.dev/overrides/mine.png");
    useProjectStore.getState().setPackOverride("tilesets/outdoor-base.png", undefined);
    expect(useProjectStore.getState().document.packOverrides).toEqual({});

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().document.packOverrides).toEqual({
      "tilesets/outdoor-base.png": "https://cdn.forge.dev/overrides/mine.png",
    });
  });

  it("setPackOverride clearing an override that was never set is a no-op that does not grow the undo log", () => {
    useProjectStore.getState().setPackOverride("tilesets/outdoor-base.png", undefined);
    expect(useProjectStore.getState().past).toHaveLength(0);
  });

  it("setTerrainRemap sets a substitute tag and undo removes the key entirely, not just clears its value", () => {
    useProjectStore.getState().setTerrainRemap("water", "sand");
    expect(useProjectStore.getState().document.packTerrainRemap).toEqual({ water: "sand" });

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().document.packTerrainRemap).toEqual({});
    expect("water" in useProjectStore.getState().document.packTerrainRemap).toBe(false);
  });

  it("setTerrainRemap with undefined clears an existing remap and undo restores it", () => {
    useProjectStore.getState().setTerrainRemap("water", "sand");
    useProjectStore.getState().setTerrainRemap("water", undefined);
    expect(useProjectStore.getState().document.packTerrainRemap).toEqual({});

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().document.packTerrainRemap).toEqual({ water: "sand" });
  });

  it("setTerrainRemap clearing a remap that was never set is a no-op that does not grow the undo log", () => {
    useProjectStore.getState().setTerrainRemap("water", undefined);
    expect(useProjectStore.getState().past).toHaveLength(0);
  });

  it("paintTile writes the tile at the given cell's flat index and undo restores the previous id", () => {
    useProjectStore.getState().createScene();
    const sceneId = useProjectStore.getState().document.scenes[0]!.id;

    useProjectStore.getState().paintTile(sceneId, 3, 2, 7);
    // GRID_WIDTH is 20 — index 2*20+3 = 43, per the same row-major layout SceneCanvas's own snapshotTiles uses.
    expect(useProjectStore.getState().document.scenes[0]!.tiles[43]).toBe(7);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().document.scenes[0]!.tiles[43]).toBe(0);
  });

  it("paintTile against an unknown scene id is a no-op that does not grow the undo log", () => {
    useProjectStore.getState().paintTile("no-such-scene", 0, 0, 3);
    expect(useProjectStore.getState().past).toHaveLength(0);
  });

  it("paintTile with the tile id already there is a no-op that does not grow the undo log", () => {
    useProjectStore.getState().createScene(); // itself one undo entry
    const sceneId = useProjectStore.getState().document.scenes[0]!.id;
    useProjectStore.getState().paintTile(sceneId, 0, 0, 0); // already 0 from scene/create's blank grid
    expect(useProjectStore.getState().past).toHaveLength(1);
  });

  it("setTerrainRemap with the same tag already set is a no-op that does not grow the undo log", () => {
    useProjectStore.getState().setTerrainRemap("water", "sand");
    useProjectStore.getState().setTerrainRemap("water", "sand");
    expect(useProjectStore.getState().past).toHaveLength(1);
  });

  it("placePlayerStart places a player-start entity and undo removes it", () => {
    useProjectStore.getState().createScene();
    const sceneId = useProjectStore.getState().document.scenes[0]?.id as string;

    useProjectStore.getState().placePlayerStart(sceneId, 3, 4);
    let scene = useProjectStore.getState().document.scenes[0]!;
    expect(scene.entities).toEqual([{ id: expect.any(String), kind: "player-start", tileX: 3, tileY: 4 }]);

    useProjectStore.getState().undo();
    scene = useProjectStore.getState().document.scenes[0]!;
    expect(scene.entities).toEqual([]);
  });

  it("placePlayerStart a second time replaces the first — only one player start per scene", () => {
    useProjectStore.getState().createScene();
    const sceneId = useProjectStore.getState().document.scenes[0]?.id as string;

    useProjectStore.getState().placePlayerStart(sceneId, 3, 4);
    useProjectStore.getState().placePlayerStart(sceneId, 10, 8);
    const scene = useProjectStore.getState().document.scenes[0]!;
    expect(scene.entities).toHaveLength(1);
    expect(scene.entities[0]).toMatchObject({ tileX: 10, tileY: 8 });

    useProjectStore.getState().undo();
    const afterUndo = useProjectStore.getState().document.scenes[0]!;
    expect(afterUndo.entities).toHaveLength(1);
    expect(afterUndo.entities[0]).toMatchObject({ tileX: 3, tileY: 4 });
  });

  it("placeNpc adds an npc, auto-selects it, and undo removes it", () => {
    useProjectStore.getState().createScene();
    const sceneId = useProjectStore.getState().document.scenes[0]?.id as string;

    useProjectStore.getState().placeNpc(sceneId, 5, 5);
    const state = useProjectStore.getState();
    const scene = state.document.scenes[0]!;
    expect(scene.entities).toHaveLength(1);
    expect(scene.entities[0]).toMatchObject({ kind: "npc", tileX: 5, tileY: 5 });
    expect(state.selection).toEqual({ kind: "entity", sceneId, entityId: scene.entities[0]!.id });

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().document.scenes[0]!.entities).toEqual([]);
  });

  it("placeNpc twice keeps both — unlike player-start, npcs are not exclusive", () => {
    useProjectStore.getState().createScene();
    const sceneId = useProjectStore.getState().document.scenes[0]?.id as string;
    useProjectStore.getState().placeNpc(sceneId, 1, 1);
    useProjectStore.getState().placeNpc(sceneId, 2, 2);
    expect(useProjectStore.getState().document.scenes[0]!.entities).toHaveLength(2);
  });

  it("removeEntity deletes it, clears a matching selection, and undo restores both", () => {
    useProjectStore.getState().createScene();
    const sceneId = useProjectStore.getState().document.scenes[0]?.id as string;
    useProjectStore.getState().placeNpc(sceneId, 5, 5);
    const entityId = useProjectStore.getState().document.scenes[0]!.entities[0]!.id;

    useProjectStore.getState().removeEntity(sceneId, entityId);
    expect(useProjectStore.getState().document.scenes[0]!.entities).toEqual([]);
    expect(useProjectStore.getState().selection).toBeUndefined();

    useProjectStore.getState().undo();
    const restored = useProjectStore.getState().document.scenes[0]!.entities;
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ id: entityId, kind: "npc", tileX: 5, tileY: 5 });
  });

  it("removeEntity for a non-existent entity is a no-op", () => {
    useProjectStore.getState().createScene();
    const sceneId = useProjectStore.getState().document.scenes[0]?.id as string;
    useProjectStore.getState().removeEntity(sceneId, "does-not-exist");
    expect(useProjectStore.getState().past).toHaveLength(1); // only createScene
  });

  it("configureEntityDialogue sets the npc's dialogue and undo restores the prior value", () => {
    useProjectStore.getState().createScene();
    const sceneId = useProjectStore.getState().document.scenes[0]?.id as string;
    useProjectStore.getState().placeNpc(sceneId, 5, 5);
    const entityId = useProjectStore.getState().document.scenes[0]!.entities[0]!.id;

    useProjectStore.getState().configureEntityDialogue(sceneId, entityId, { speaker: "Shopkeeper", text: "Welcome!" });
    let entity = useProjectStore.getState().document.scenes[0]!.entities[0]!;
    expect(entity.dialogue).toEqual({ speaker: "Shopkeeper", text: "Welcome!" });

    useProjectStore.getState().undo();
    entity = useProjectStore.getState().document.scenes[0]!.entities[0]!;
    expect(entity.dialogue).toBeUndefined();
  });

  it("configureEntityDialogue with an unchanged value is a no-op that does not grow the undo log", () => {
    useProjectStore.getState().createScene();
    const sceneId = useProjectStore.getState().document.scenes[0]?.id as string;
    useProjectStore.getState().placeNpc(sceneId, 5, 5);
    const entityId = useProjectStore.getState().document.scenes[0]!.entities[0]!.id;
    const dialogue = { speaker: "Shopkeeper", text: "Welcome!" };

    useProjectStore.getState().configureEntityDialogue(sceneId, entityId, dialogue);
    const pastLength = useProjectStore.getState().past.length;
    useProjectStore.getState().configureEntityDialogue(sceneId, entityId, dialogue);
    expect(useProjectStore.getState().past).toHaveLength(pastLength);
  });

  it("selectEntity sets and clears the selection", () => {
    useProjectStore.getState().createScene();
    const sceneId = useProjectStore.getState().document.scenes[0]?.id as string;
    useProjectStore.getState().placeNpc(sceneId, 5, 5);
    const entityId = useProjectStore.getState().document.scenes[0]!.entities[0]!.id;

    useProjectStore.getState().selectEntity(sceneId, entityId);
    expect(useProjectStore.getState().selection).toEqual({ kind: "entity", sceneId, entityId });

    useProjectStore.getState().selectEntity(sceneId, undefined);
    expect(useProjectStore.getState().selection).toBeUndefined();
  });
});

describe("migratePersistedProjectState", () => {
  it("fills in activePack/packOverrides for pre-Art-Pack (version 1) persisted state", () => {
    const legacy = {
      document: { scenes: [{ id: "s1", name: "Scene 1", entities: [] }], installedModules: { "@forge/inventory": {} } },
      past: [],
      future: [],
    };
    const migrated = migratePersistedProjectState(legacy);
    expect(migrated.document.scenes).toEqual([{ id: "s1", name: "Scene 1", entities: [], tiles: new Array(300).fill(0) }]);
    // Pre-InstalledModuleEntry (version 4 and earlier) persisted a flat
    // config record directly — migrateDocument wraps it as { config: ... },
    // a lossless upgrade since a first-party module re-saved under the old
    // shape never had a marketplace pin to lose.
    expect(migrated.document.installedModules).toEqual({ "@forge/inventory": { config: {} } });
    expect(migrated.document.activePack).toBeUndefined();
    expect(migrated.document.packOverrides).toEqual({});
    expect(migrated.document.packTerrainRemap).toEqual({});
    expect(migrated.checkpoints).toEqual([]);
  });

  it("fills in checkpoints for pre-checkpoint (version 2) persisted state", () => {
    const v2 = {
      document: { scenes: [], installedModules: {}, activePack: "@pixelfoundry/fantasy-pack", packOverrides: {} },
      past: [],
      future: [],
    };
    const migrated = migratePersistedProjectState(v2);
    expect(migrated.checkpoints).toEqual([]);
  });

  it("fills in packTerrainRemap, including inside each checkpoint's own snapshot, for pre-remap (version 3) persisted state", () => {
    const v3 = {
      document: { scenes: [], installedModules: {}, activePack: "@pixelfoundry/fantasy-pack", packOverrides: {} },
      past: [],
      future: [],
      checkpoints: [
        {
          id: "c1",
          label: "Before switching to fantasy-pack",
          createdAt: "2026-08-08T00:00:00.000Z",
          document: { scenes: [], installedModules: {}, activePack: undefined, packOverrides: {} },
        },
      ],
    };
    const migrated = migratePersistedProjectState(v3);
    expect(migrated.document.packTerrainRemap).toEqual({});
    expect(migrated.checkpoints[0]!.document.packTerrainRemap).toEqual({});
  });

  it("fills in scene tiles, including inside each checkpoint's own snapshot, for pre-tiles (version 4) persisted state", () => {
    const v4 = {
      document: {
        scenes: [{ id: "s1", name: "Scene 1", entities: [] }],
        installedModules: {},
        activePack: undefined,
        packOverrides: {},
        packTerrainRemap: {},
      },
      past: [],
      future: [],
      checkpoints: [
        {
          id: "c1",
          label: "Before switching to fantasy-pack",
          createdAt: "2026-08-08T00:00:00.000Z",
          document: {
            scenes: [{ id: "s1", name: "Scene 1", entities: [] }],
            installedModules: {},
            activePack: undefined,
            packOverrides: {},
            packTerrainRemap: {},
          },
        },
      ],
    };
    const migrated = migratePersistedProjectState(v4);
    const blankTiles = new Array(300).fill(0);
    expect(migrated.document.scenes).toEqual([{ id: "s1", name: "Scene 1", entities: [], tiles: blankTiles }]);
    expect(migrated.checkpoints[0]!.document.scenes).toEqual([{ id: "s1", name: "Scene 1", entities: [], tiles: blankTiles }]);
  });

  it("passes a full, current-shape document through unchanged", () => {
    const current = {
      document: {
        scenes: [],
        installedModules: {},
        activePack: "@pixelfoundry/fantasy-pack",
        packOverrides: { "a.png": "https://cdn.forge.dev/a.png" },
        packTerrainRemap: { water: "sand" },
      },
      past: [],
      future: [],
      checkpoints: [
        {
          id: "c1",
          label: "Before switching to fantasy-pack",
          createdAt: "2026-08-08T00:00:00.000Z",
          document: { scenes: [], installedModules: {}, activePack: undefined, packOverrides: {}, packTerrainRemap: {} },
        },
      ],
    };
    const migrated = migratePersistedProjectState(current);
    expect(migrated.document).toEqual(current.document);
    expect(migrated.checkpoints).toEqual(current.checkpoints);
  });

  it("never throws on empty or missing persisted state", () => {
    expect(() => migratePersistedProjectState(undefined)).not.toThrow();
    expect(() => migratePersistedProjectState({})).not.toThrow();
    const migrated = migratePersistedProjectState(undefined);
    expect(migrated.document).toEqual({
      scenes: [],
      installedModules: {},
      activePack: undefined,
      packOverrides: {},
      packTerrainRemap: {},
    });
    expect(migrated.checkpoints).toEqual([]);
  });
});

describe("checkpoints: docs/SPEC.md Section 11.5's automatic checkpoint + one-click restore", () => {
  beforeEach(reset);

  it("createCheckpoint snapshots the current document under a label and returns its id", () => {
    useProjectStore.getState().createScene();
    useProjectStore.getState().setActivePack("@pixelfoundry/fantasy-pack");

    const id = useProjectStore.getState().createCheckpoint("Before switching to scifi-pack");

    const checkpoints = useProjectStore.getState().checkpoints;
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]!.id).toBe(id);
    expect(checkpoints[0]!.label).toBe("Before switching to scifi-pack");
    expect(checkpoints[0]!.document.activePack).toBe("@pixelfoundry/fantasy-pack");
    expect(checkpoints[0]!.document.scenes).toHaveLength(1);
  });

  it("createCheckpoint's snapshot is independent of later edits", () => {
    useProjectStore.getState().setActivePack("@pixelfoundry/fantasy-pack");
    const id = useProjectStore.getState().createCheckpoint("checkpoint");

    useProjectStore.getState().setActivePack("@moonlit/scifi-pack");
    useProjectStore.getState().createScene();

    const checkpoint = useProjectStore.getState().checkpoints.find((c) => c.id === id);
    expect(checkpoint?.document.activePack).toBe("@pixelfoundry/fantasy-pack");
    expect(checkpoint?.document.scenes).toEqual([]);
    expect(useProjectStore.getState().document.activePack).toBe("@moonlit/scifi-pack");
  });

  it("restoreCheckpoint replaces the document with the checkpoint's snapshot and is itself undoable", () => {
    useProjectStore.getState().setActivePack("@pixelfoundry/fantasy-pack");
    const id = useProjectStore.getState().createCheckpoint("checkpoint");
    useProjectStore.getState().setActivePack("@moonlit/scifi-pack");
    useProjectStore.getState().createScene();

    useProjectStore.getState().restoreCheckpoint(id);
    expect(useProjectStore.getState().document.activePack).toBe("@pixelfoundry/fantasy-pack");
    expect(useProjectStore.getState().document.scenes).toEqual([]);

    useProjectStore.getState().undo();
    expect(useProjectStore.getState().document.activePack).toBe("@moonlit/scifi-pack");
    expect(useProjectStore.getState().document.scenes).toHaveLength(1);
  });

  it("restoreCheckpoint with an unknown id is a no-op", () => {
    useProjectStore.getState().createScene();
    const before = useProjectStore.getState().document;
    const pastLengthBefore = useProjectStore.getState().past.length;

    useProjectStore.getState().restoreCheckpoint("does-not-exist");

    expect(useProjectStore.getState().document).toEqual(before);
    expect(useProjectStore.getState().past).toHaveLength(pastLengthBefore);
  });

  it("deleteCheckpoint removes it from the list without touching the document or undo history", () => {
    const id = useProjectStore.getState().createCheckpoint("checkpoint");
    useProjectStore.getState().createScene();
    const documentBefore = useProjectStore.getState().document;

    useProjectStore.getState().deleteCheckpoint(id);

    expect(useProjectStore.getState().checkpoints).toEqual([]);
    expect(useProjectStore.getState().document).toBe(documentBefore);
  });
});
