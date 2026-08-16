import { describe, expect, it } from "vitest";
import type { ProjectDocument } from "../src/documentTypes.js";
import { emptyTiles } from "../src/documentTypes.js";
import { CURRENT_PROJECT_SCHEMA_VERSION, toExportProjectInput } from "../src/toExportProjectInput.js";

function baseDocument(overrides: Partial<ProjectDocument> = {}): ProjectDocument {
  return {
    scenes: [],
    installedModules: {},
    activePack: undefined,
    packOverrides: {},
    packTerrainRemap: {},
    ...overrides,
  };
}

const resolveModuleVersion = (name: string) => `1.0.0-${name.replace("@forge/", "")}`;
const resolveEngineVersion = () => "2.3.4";

describe("toExportProjectInput", () => {
  it("throws if the project has no scenes", () => {
    expect(() =>
      toExportProjectInput(baseDocument(), { projectId: "p1", resolveModuleVersion, resolveEngineVersion }),
    ).toThrow(/no scenes/);
  });

  it("throws if startSceneId doesn't match any scene", () => {
    const document = baseDocument({
      scenes: [{ id: "village", name: "Village", entities: [], tiles: emptyTiles() }],
    });
    expect(() =>
      toExportProjectInput(document, {
        projectId: "p1",
        startSceneId: "nonexistent",
        resolveModuleVersion,
        resolveEngineVersion,
      }),
    ).toThrow(/does not match any scene/);
  });

  it("defaults startSceneId to the first scene", () => {
    const document = baseDocument({
      scenes: [
        { id: "village", name: "Village", entities: [], tiles: emptyTiles() },
        { id: "cave", name: "Cave", entities: [], tiles: emptyTiles() },
      ],
    });
    const result = toExportProjectInput(document, { projectId: "p1", resolveModuleVersion, resolveEngineVersion });
    expect(result.startSceneId).toBe("village");
  });

  it("maps scenes and entities, carrying dialogue only when present", () => {
    const document = baseDocument({
      scenes: [
        {
          id: "village",
          name: "Village",
          tiles: emptyTiles(),
          entities: [
            { id: "player-1", kind: "player-start", tileX: 2, tileY: 3 },
            { id: "npc-1", kind: "npc", tileX: 5, tileY: 5, dialogue: { speaker: "Elder", text: "Welcome." } },
            { id: "npc-2", kind: "npc", tileX: 6, tileY: 6 },
          ],
        },
      ],
    });
    const result = toExportProjectInput(document, { projectId: "p1", resolveModuleVersion, resolveEngineVersion });
    expect(result.scenes).toHaveLength(1);
    const [scene] = result.scenes;
    expect(scene!.entities).toEqual([
      { id: "player-1", kind: "player-start", tileX: 2, tileY: 3 },
      { id: "npc-1", kind: "npc", tileX: 5, tileY: 5, dialogue: { speaker: "Elder", text: "Welcome." } },
      { id: "npc-2", kind: "npc", tileX: 6, tileY: 6 },
    ]);
    // exactOptionalPropertyTypes: npc-2 must have no "dialogue" key at all, not dialogue: undefined.
    expect("dialogue" in scene!.entities[2]!).toBe(false);
  });

  it("stamps the current schema version and the caller-resolved engine version", () => {
    const document = baseDocument({
      scenes: [{ id: "village", name: "Village", entities: [], tiles: emptyTiles() }],
    });
    const result = toExportProjectInput(document, { projectId: "p1", resolveModuleVersion, resolveEngineVersion });
    expect(result.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
    expect(result.engineVersion).toBe("2.3.4");
    expect(result.projectId).toBe("p1");
  });

  it("generates a fresh buildId per call unless one is supplied", () => {
    const document = baseDocument({
      scenes: [{ id: "village", name: "Village", entities: [], tiles: emptyTiles() }],
    });
    const a = toExportProjectInput(document, { projectId: "p1", resolveModuleVersion, resolveEngineVersion });
    const b = toExportProjectInput(document, { projectId: "p1", resolveModuleVersion, resolveEngineVersion });
    expect(a.buildId).not.toBe(b.buildId);
    const c = toExportProjectInput(document, {
      projectId: "p1",
      buildId: "fixed-id",
      resolveModuleVersion,
      resolveEngineVersion,
    });
    expect(c.buildId).toBe("fixed-id");
  });

  it("passes inventory/turn-battle config through unchanged, with a resolved version", () => {
    const document = baseDocument({
      scenes: [{ id: "village", name: "Village", entities: [], tiles: emptyTiles() }],
      installedModules: {
        "@forge/inventory": { defaultMaxSlots: 24 },
      },
    });
    const result = toExportProjectInput(document, { projectId: "p1", resolveModuleVersion, resolveEngineVersion });
    expect(result.installedModules).toEqual([
      { name: "@forge/inventory", version: "1.0.0-inventory", config: { defaultMaxSlots: 24 } },
    ]);
  });

  it("synthesizes @forge/dialogue's trees from NPC dialogue across every scene, keyed by treeId == placementId", () => {
    const document = baseDocument({
      scenes: [
        {
          id: "village",
          name: "Village",
          tiles: emptyTiles(),
          entities: [
            { id: "npc-elder", kind: "npc", tileX: 1, tileY: 1, dialogue: { speaker: "Elder", text: "Welcome." } },
            { id: "npc-silent", kind: "npc", tileX: 2, tileY: 2 },
          ],
        },
        {
          id: "cave",
          name: "Cave",
          tiles: emptyTiles(),
          entities: [
            { id: "npc-hermit", kind: "npc", tileX: 3, tileY: 3, dialogue: { speaker: "Hermit", text: "Go away." } },
          ],
        },
      ],
      // Dialogue has no flat configSchema — installing it stores {} (no form fields), same as the editor's ModulesPanel does today.
      installedModules: { "@forge/dialogue": {} },
    });
    const result = toExportProjectInput(document, { projectId: "p1", resolveModuleVersion, resolveEngineVersion });
    expect(result.installedModules).toHaveLength(1);
    const [dialogueModule] = result.installedModules;
    expect(dialogueModule!.name).toBe("@forge/dialogue");
    expect(dialogueModule!.config).toEqual({
      trees: [
        { id: "npc-elder", nodes: [{ speaker: "Elder", text: "Welcome." }] },
        { id: "npc-hermit", nodes: [{ speaker: "Hermit", text: "Go away." }] },
      ],
    });
  });

  it("omits a module entirely when it isn't installed", () => {
    const document = baseDocument({
      scenes: [{ id: "village", name: "Village", entities: [], tiles: emptyTiles() }],
    });
    const result = toExportProjectInput(document, { projectId: "p1", resolveModuleVersion, resolveEngineVersion });
    expect(result.installedModules).toEqual([]);
  });
});
