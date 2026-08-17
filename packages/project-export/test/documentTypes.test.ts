import { describe, expect, it } from "vitest";
import { emptyTiles, migrateDocument } from "../src/documentTypes.js";

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

  it("defaults installedModules to {} when the whole document is missing it", () => {
    const migrated = migrateDocument(undefined);
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
  });
});
