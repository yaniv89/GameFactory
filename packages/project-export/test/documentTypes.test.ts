import { describe, expect, it } from "vitest";
import { DEFAULT_INSTALLED_MODULES, emptyTiles, migrateDocument } from "../src/documentTypes.js";

describe("migrateDocument", () => {
  it("wraps a pre-InstalledModuleEntry flat config record as { config }", () => {
    const migrated = migrateDocument({
      scenes: [],
      // The shape every installedModules entry had before InstalledModuleEntry
      // existed: the config values directly, not wrapped in { config }.
      installedModules: { "@forge/inventory": { defaultMaxSlots: 20 } } as never,
    });

    expect(migrated.installedModules).toEqual({
      "@forge/inventory": { config: { defaultMaxSlots: 20 } },
    });
  });

  it("wraps a legacy entry with no config fields at all (an empty flat record) as { config: {} }", () => {
    const migrated = migrateDocument({
      scenes: [],
      installedModules: { "@forge/dialogue": {} } as never,
    });

    expect(migrated.installedModules).toEqual({ "@forge/dialogue": { config: {} } });
  });

  it("passes a current-shape entry (config only, no marketplace pin) through unchanged", () => {
    const current = { "@forge/turn-battle": { config: { baseHitChance: 0.9 } } };
    const migrated = migrateDocument({ scenes: [], installedModules: current });
    expect(migrated.installedModules).toEqual(current);
  });

  it("passes a current-shape entry with a marketplace pin through unchanged", () => {
    const current = {
      "@acme/loot-tables": {
        config: { dropRate: 0.2 },
        marketplace: { version: "1.2.0", bundleUrl: "https://cdn.forge.dev/packages/@acme/loot-tables/1.2.0/bundle.js", bundleSha256Hex: "abc123" },
      },
    };
    const migrated = migrateDocument({ scenes: [], installedModules: current });
    expect(migrated.installedModules).toEqual(current);
  });

  it("migrates a mix of legacy and current-shape entries in the same document independently", () => {
    const migrated = migrateDocument({
      scenes: [],
      installedModules: {
        "@forge/inventory": { defaultMaxSlots: 20 } as never,
        "@acme/loot-tables": { config: { dropRate: 0.2 }, marketplace: { version: "1.2.0", bundleUrl: "https://cdn.forge.dev/loot.js", bundleSha256Hex: "abc123" } },
      },
    });

    expect(migrated.installedModules).toEqual({
      "@forge/inventory": { config: { defaultMaxSlots: 20 } },
      "@acme/loot-tables": { config: { dropRate: 0.2 }, marketplace: { version: "1.2.0", bundleUrl: "https://cdn.forge.dev/loot.js", bundleSha256Hex: "abc123" } },
    });
  });

  it("leaves an empty installedModules map empty", () => {
    const migrated = migrateDocument({ scenes: [], installedModules: {} });
    expect(migrated.installedModules).toEqual({});
  });

  it("defaults installedModules to DEFAULT_INSTALLED_MODULES (dialogue + inventory) when the whole document is missing — a genuinely brand-new project", () => {
    const migrated = migrateDocument(undefined);
    expect(migrated.installedModules).toEqual(DEFAULT_INSTALLED_MODULES);
  });

  it("does NOT apply DEFAULT_INSTALLED_MODULES when a real (if incomplete) document merely omits the field — an existing project's own {} is left alone, not silently edited", () => {
    const migrated = migrateDocument({ scenes: [] });
    expect(migrated.installedModules).toEqual({});
  });

  it("still fills in every other field a partial document is missing, alongside the module-entry migration", () => {
    const migrated = migrateDocument({
      scenes: [{ id: "s1", name: "Scene 1", entities: [] }] as never,
      installedModules: { "@forge/inventory": { defaultMaxSlots: 20 } } as never,
    });

    expect(migrated.scenes).toEqual([{ id: "s1", name: "Scene 1", entities: [], tiles: emptyTiles() }]);
    expect(migrated.installedModules).toEqual({ "@forge/inventory": { config: { defaultMaxSlots: 20 } } });
    expect(migrated.activePack).toBeUndefined();
    expect(migrated.packOverrides).toEqual({});
    expect(migrated.packTerrainRemap).toEqual({});
    expect(migrated.graphs).toEqual({});
  });

  it("defaults graphs to {} for a document that predates the node-graph field, without touching an existing graphs map", () => {
    expect(migrateDocument({ scenes: [] }).graphs).toEqual({});

    const existing = {
      g1: { id: "g1", name: "Boss fight logic", nodes: [], edges: [] },
    };
    expect(migrateDocument({ scenes: [], graphs: existing } as never).graphs).toBe(existing);
  });

  // docs/adr/0015-entity-prefab-component-model.md: a document persisted
  // before EntityPlacement.prefabId existed carried kind: "player-start" |
  // "npc" instead. The migration is a pure field rename — kind's value and
  // prefabId's value are the same strings by design — so these assert the
  // exact resulting object, not just that migration "did something".
  it("renames a legacy player-start entity's kind to prefabId", () => {
    const migrated = migrateDocument({
      scenes: [
        {
          id: "s1",
          name: "Scene 1",
          entities: [{ id: "e1", kind: "player-start", tileX: 3, tileY: 4 } as never],
        } as never,
      ],
      installedModules: {},
    });

    expect(migrated.scenes[0]!.entities).toEqual([{ id: "e1", prefabId: "player-start", tileX: 3, tileY: 4 }]);
  });

  it("renames a legacy npc entity's kind to prefabId, preserving dialogue", () => {
    const migrated = migrateDocument({
      scenes: [
        {
          id: "s1",
          name: "Scene 1",
          entities: [
            { id: "e2", kind: "npc", tileX: 5, tileY: 5, dialogue: { speaker: "Elder", text: "Welcome." } } as never,
          ],
        } as never,
      ],
      installedModules: {},
    });

    expect(migrated.scenes[0]!.entities).toEqual([
      { id: "e2", prefabId: "npc", tileX: 5, tileY: 5, dialogue: { speaker: "Elder", text: "Welcome." } },
    ]);
  });

  it("passes a current-shape entity (prefabId already present) through unchanged", () => {
    const migrated = migrateDocument({
      scenes: [
        {
          id: "s1",
          name: "Scene 1",
          tiles: emptyTiles(),
          entities: [{ id: "e3", prefabId: "player-start", tileX: 1, tileY: 1 }],
        },
      ],
      installedModules: {},
    });

    expect(migrated.scenes[0]!.entities).toEqual([{ id: "e3", prefabId: "player-start", tileX: 1, tileY: 1 }]);
  });

  it("migrates a mix of legacy and current-shape entities in the same scene independently", () => {
    const migrated = migrateDocument({
      scenes: [
        {
          id: "s1",
          name: "Scene 1",
          entities: [
            { id: "legacy", kind: "npc", tileX: 2, tileY: 2 } as never,
            { id: "current", prefabId: "player-start", tileX: 0, tileY: 0 },
          ],
        } as never,
      ],
      installedModules: {},
    });

    expect(migrated.scenes[0]!.entities).toEqual([
      { id: "legacy", prefabId: "npc", tileX: 2, tileY: 2 },
      { id: "current", prefabId: "player-start", tileX: 0, tileY: 0 },
    ]);
  });
});
