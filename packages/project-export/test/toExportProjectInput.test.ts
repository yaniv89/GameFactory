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
    graphs: {},
    quests: {},
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
      // @forge/dialogue must be installed for an entity with dialogue authored
      // to survive export — see the "refuses to export ... dialogue" tests below.
      installedModules: { "@forge/dialogue": { config: {} } },
      scenes: [
        {
          id: "village",
          name: "Village",
          tiles: emptyTiles(),
          entities: [
            { id: "player-1", prefabId: "player-start", tileX: 2, tileY: 3 },
            { id: "npc-1", prefabId: "npc", tileX: 5, tileY: 5, dialogue: { nodes: [{ speaker: "Elder", text: "Welcome." }] } },
            { id: "npc-2", prefabId: "npc", tileX: 6, tileY: 6 },
          ],
        },
      ],
    });
    const result = toExportProjectInput(document, { projectId: "p1", resolveModuleVersion, resolveEngineVersion });
    expect(result.scenes).toHaveLength(1);
    const [scene] = result.scenes;
    expect(scene!.entities).toEqual([
      { id: "player-1", prefabId: "player-start", tileX: 2, tileY: 3 },
      { id: "npc-1", prefabId: "npc", tileX: 5, tileY: 5, dialogue: { nodes: [{ speaker: "Elder", text: "Welcome." }] } },
      { id: "npc-2", prefabId: "npc", tileX: 6, tileY: 6 },
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
        "@forge/inventory": { config: { defaultMaxSlots: 24 } },
      },
    });
    const result = toExportProjectInput(document, { projectId: "p1", resolveModuleVersion, resolveEngineVersion });
    expect(result.installedModules).toEqual([
      { name: "@forge/inventory", version: "1.0.0-inventory", config: { defaultMaxSlots: 24 } },
    ]);
  });

  it("uses a marketplace-installed module's own pinned version instead of resolveModuleVersion", () => {
    const document = baseDocument({
      scenes: [{ id: "village", name: "Village", entities: [], tiles: emptyTiles() }],
      installedModules: {
        "@acme/loot-tables": {
          config: { dropRate: 0.2 },
          marketplace: {
            version: "2.4.1",
            bundleUrl: "https://cdn.forge.dev/packages/@acme/loot-tables/2.4.1/bundle.js",
            bundleSha256Hex: "deadbeef",
          },
        },
      },
    });
    // resolveModuleVersion would throw for a package that was never a local
    // node_modules dependency of packages/player — proving it's never even
    // called for a marketplace-pinned module, not just that its return
    // value gets overridden.
    const result = toExportProjectInput(document, {
      projectId: "p1",
      resolveModuleVersion: () => {
        throw new Error("resolveModuleVersion should not be called for a marketplace-pinned module");
      },
      resolveEngineVersion,
    });
    expect(result.installedModules).toEqual([
      {
        name: "@acme/loot-tables",
        version: "2.4.1",
        config: { dropRate: 0.2 },
        guestBundleUrl: "https://cdn.forge.dev/packages/@acme/loot-tables/2.4.1/bundle.js",
        guestBundleSha256Hex: "deadbeef",
      },
    ]);
  });

  it("synthesizes @forge/quests' config from document.quests (docs/adr/0018 Decision 1) — every authored quest, not a flat form", () => {
    const document = baseDocument({
      scenes: [{ id: "village", name: "Village", entities: [], tiles: emptyTiles() }],
      installedModules: { "@forge/quests": { config: {} } },
      quests: {
        killWolves: {
          id: "killWolves",
          name: "Wolf Trouble",
          description: "Deal with the wolves near the mill.",
          objectives: [{ id: "kill3Wolves", description: "Kill 3 wolves" }],
        },
      },
    });
    const result = toExportProjectInput(document, { projectId: "p1", resolveModuleVersion, resolveEngineVersion });
    expect(result.installedModules).toEqual([
      {
        name: "@forge/quests",
        version: "1.0.0-quests",
        config: {
          quests: [
            {
              id: "killWolves",
              name: "Wolf Trouble",
              description: "Deal with the wolves near the mill.",
              objectives: [{ id: "kill3Wolves", description: "Kill 3 wolves" }],
            },
          ],
        },
      },
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
            { id: "npc-elder", prefabId: "npc", tileX: 1, tileY: 1, dialogue: { nodes: [{ speaker: "Elder", text: "Welcome." }] } },
            { id: "npc-silent", prefabId: "npc", tileX: 2, tileY: 2 },
          ],
        },
        {
          id: "cave",
          name: "Cave",
          tiles: emptyTiles(),
          entities: [
            { id: "npc-hermit", prefabId: "npc", tileX: 3, tileY: 3, dialogue: { nodes: [{ speaker: "Hermit", text: "Go away." }] } },
          ],
        },
      ],
      // Dialogue has no flat configSchema — installing it stores an empty config (no form fields), same as the editor's ModulesPanel does today.
      installedModules: { "@forge/dialogue": { config: {} } },
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

  // issue #123: the editor's own live preview used to run @forge/dialogue
  // regardless of install status, so a creator could author dialogue, see
  // it work in preview, and get a silently broken (no-op) interaction on
  // export instead — this refuses the export outright with a clear,
  // actionable error rather than reproducing that silence.
  it("refuses to export a scene with dialogue authored when @forge/dialogue isn't installed", () => {
    const document = baseDocument({
      scenes: [
        {
          id: "village",
          name: "Village",
          tiles: emptyTiles(),
          entities: [{ id: "npc-1", prefabId: "npc", tileX: 5, tileY: 5, dialogue: { nodes: [{ speaker: "Elder", text: "Welcome." }] } }],
        },
      ],
    });
    expect(() => toExportProjectInput(document, { projectId: "p1", resolveModuleVersion, resolveEngineVersion })).toThrow(
      /scene "Village" has an entity with dialogue authored.*"@forge\/dialogue" is not installed/,
    );
  });

  it("does not refuse a scene with no dialogue authored, even when @forge/dialogue isn't installed", () => {
    const document = baseDocument({
      scenes: [{ id: "village", name: "Village", entities: [{ id: "npc-1", prefabId: "npc", tileX: 5, tileY: 5 }], tiles: emptyTiles() }],
    });
    expect(() => toExportProjectInput(document, { projectId: "p1", resolveModuleVersion, resolveEngineVersion })).not.toThrow();
  });

  it("does not refuse a scene with dialogue authored once @forge/dialogue is installed", () => {
    const document = baseDocument({
      installedModules: { "@forge/dialogue": { config: {} } },
      scenes: [
        {
          id: "village",
          name: "Village",
          tiles: emptyTiles(),
          entities: [{ id: "npc-1", prefabId: "npc", tileX: 5, tileY: 5, dialogue: { nodes: [{ speaker: "Elder", text: "Welcome." }] } }],
        },
      ],
    });
    expect(() => toExportProjectInput(document, { projectId: "p1", resolveModuleVersion, resolveEngineVersion })).not.toThrow();
  });

  it("checks every scene, not just the start scene, for un-installed dialogue", () => {
    const document = baseDocument({
      scenes: [
        { id: "village", name: "Village", entities: [], tiles: emptyTiles() },
        {
          id: "cave",
          name: "Cave",
          tiles: emptyTiles(),
          entities: [{ id: "npc-1", prefabId: "npc", tileX: 5, tileY: 5, dialogue: { nodes: [{ speaker: "Hermit", text: "Go away." }] } }],
        },
      ],
    });
    expect(() => toExportProjectInput(document, { projectId: "p1", resolveModuleVersion, resolveEngineVersion })).toThrow(/scene "Cave"/);
  });
});
