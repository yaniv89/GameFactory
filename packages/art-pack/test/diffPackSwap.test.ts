import { describe, expect, it } from "vitest";
import { diffPackSwap } from "../src/diffPackSwap";
import type { ArtPackManifest } from "../src/manifest";

/**
 * A minimal but complete manifest, close to docs/SPEC.md Section 11.5's
 * own worked example: a source pack with grass/dirt/water tiles, one
 * character sheet, and idle/walk/attack animations.
 */
function sourceManifest(): ArtPackManifest {
  return {
    schemaVersion: 1,
    name: "@pixelfoundry/fantasy-pack",
    version: "4.2.0",
    kind: "artpack",
    engine: ">=1.0.0 <2.0.0",
    grid: { tileSize: 32 },
    implements: ["forge/topdown-rpg-basic@1"],
    tilesets: {
      "outdoor-base": {
        src: "tilesets/outdoor-base.png",
        columns: 3,
        terrains: ["grass", "dirt", "water"],
      },
    },
    characters: {
      template: {
        animations: {
          idle: { frames: 4, fps: 6, directions: 4 },
          walk: { frames: 8, fps: 12, directions: 4 },
          attack: { frames: 6, fps: 15, directions: 4 },
        },
        anchor: { x: 0.5, y: 0.9 },
      },
      sheets: {
        "villager-m": "characters/villager-m.png",
        "villager-f": "characters/villager-f.png",
      },
    },
    locales: ["en"],
  };
}

describe("diffPackSwap", () => {
  it("reports OK for every terrain, character sheet, and identical animation when the target is a superset", () => {
    const source = sourceManifest();
    const target: ArtPackManifest = {
      ...sourceManifest(),
      name: "@moonlit/scifi-pack",
      version: "2.0.1",
    };

    const result = diffPackSwap(source, target);

    expect(result.hasFailures).toBe(false);
    expect(result.findings).toEqual([
      { severity: "ok", message: "3 tiles map by terrain tag" },
      { severity: "ok", message: "2 character sheets map by role tag" },
    ]);
    expect(result.missingTerrains).toEqual([]);
    expect(result.targetTerrains).toEqual(["dirt", "grass", "water"]);
  });

  it("mirrors docs/SPEC.md Section 11.5's own example: matched terrains/sheets, a missing terrain, a tile-size warning, a resampled animation, and a missing animation", () => {
    const source = sourceManifest();
    const target: ArtPackManifest = {
      schemaVersion: 1,
      name: "@moonlit/scifi-pack",
      version: "2.0.1",
      kind: "artpack",
      engine: ">=1.0.0 <2.0.0",
      grid: { tileSize: 16 },
      implements: ["forge/topdown-rpg-basic@1"],
      tilesets: {
        "outdoor-base": {
          src: "tilesets/outdoor-base.png",
          columns: 2,
          terrains: ["grass", "dirt"],
        },
      },
      characters: {
        template: {
          animations: {
            idle: { frames: 4, fps: 6, directions: 4 },
            walk: { frames: 8, fps: 12, directions: 4 },
            attack: { frames: 4, fps: 15, directions: 4 },
          },
          anchor: { x: 0.5, y: 0.9 },
        },
        sheets: {
          "villager-m": "characters/villager-m.png",
          "villager-f": "characters/villager-f.png",
        },
      },
      locales: ["en"],
    };

    const result = diffPackSwap(source, target);

    expect(result.hasFailures).toBe(true);
    expect(result.findings).toEqual([
      { severity: "ok", message: "2 tiles map by terrain tag" },
      {
        severity: "fail",
        message: "1 prop has no equivalent: 'water'",
        detail: "These will render as placeholders until remapped.",
      },
      {
        severity: "warn",
        message: "Tile size differs (32 -> 16)",
        detail: "Scenes will be rescaled.",
      },
      { severity: "ok", message: "2 character sheets map by role tag" },
      {
        severity: "warn",
        message: "'attack' animation has 4 frames in target, 6 in source",
        detail: "Timing will be resampled.",
      },
    ]);
    expect(result.missingTerrains).toEqual(["water"]);
    expect(result.targetTerrains).toEqual(["dirt", "grass"]);
  });

  it("reports FAIL for a character sheet with no equivalent role in the target", () => {
    const source = sourceManifest();
    const target: ArtPackManifest = {
      ...sourceManifest(),
      characters: {
        template: source.characters!.template,
        sheets: { "villager-m": "characters/villager-m.png" },
      },
    };

    const result = diffPackSwap(source, target);

    expect(result.hasFailures).toBe(true);
    expect(result.findings).toContainEqual({
      severity: "fail",
      message: "1 character sheet has no equivalent: 'villager-f'",
      detail: "These will render as placeholders until remapped.",
    });
  });

  it("reports FAIL for an animation with no equivalent name in the target", () => {
    const source = sourceManifest();
    const target: ArtPackManifest = {
      ...sourceManifest(),
      characters: {
        template: {
          animations: {
            idle: { frames: 4, fps: 6, directions: 4 },
            walk: { frames: 8, fps: 12, directions: 4 },
          },
          anchor: { x: 0.5, y: 0.9 },
        },
        sheets: source.characters!.sheets,
      },
    };

    const result = diffPackSwap(source, target);

    expect(result.hasFailures).toBe(true);
    expect(result.findings).toContainEqual({
      severity: "fail",
      message: "1 animation has no equivalent: 'attack'",
      detail: "These will be skipped until remapped.",
    });
  });

  it("skips terrain/character findings entirely when the source declares no tilesets or characters", () => {
    const source: ArtPackManifest = {
      schemaVersion: 1,
      name: "@empty/pack",
      version: "1.0.0",
      kind: "artpack",
      engine: ">=1.0.0 <2.0.0",
      grid: { tileSize: 32 },
      implements: [],
      tilesets: {},
      locales: ["en"],
    };
    const target = sourceManifest();

    const result = diffPackSwap(source, target);

    expect(result.hasFailures).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.missingTerrains).toEqual([]);
    expect(result.targetTerrains).toEqual(["dirt", "grass", "water"]);
  });
});

/** `sourceManifest()` minus `characters`/`tilesets` content — a base for tests that only care about the five new categories, so their own OK/FAIL findings aren't mixed in with terrain/character-sheet ones. */
function newCategoriesBaseManifest(): ArtPackManifest {
  const { characters: _characters, ...withoutCharacters } = sourceManifest();
  return { ...withoutCharacters, tilesets: {} };
}

describe("diffPackSwap: docs/adr/0014's five new asset categories", () => {
  it("reports OK for vehicles/wagons/weapons/vfx/props that all map by id in the target", () => {
    // Two entries per category, matching the rest of this suite's own
    // convention of testing the "matched" path with a plural count
    // (diffTerrains/diffCharacterSheets' OK messages are never
    // grammar-conjugated for a singular count either — this sidesteps
    // that pre-existing, unrelated wrinkle rather than asserting on it).
    const source: ArtPackManifest = {
      ...newCategoriesBaseManifest(),
      vehicles: { cart: { src: "vehicles/cart.png", anchor: { x: 32, y: 60 } }, wagon: { src: "vehicles/wagon.png", anchor: { x: 32, y: 60 } } },
      wagons: { mule: { src: "wagons/mule.png", anchor: { x: 16, y: 32 } }, ox: { src: "wagons/ox.png", anchor: { x: 16, y: 32 } } },
      weapons: { sword: { src: "weapons/sword.png", anchor: { x: 4, y: 28 } }, axe: { src: "weapons/axe.png", anchor: { x: 4, y: 28 } } },
      vfx: {
        spark: { src: "vfx/spark.png", frameCount: 5, fps: 12, anchor: { x: 16, y: 16 } },
        smoke: { src: "vfx/smoke.png", frameCount: 6, fps: 10, anchor: { x: 16, y: 16 } },
      },
      props: { barrel: { src: "props/barrel.png", anchor: { x: 16, y: 30 } }, crate: { src: "props/crate.png", anchor: { x: 16, y: 30 } } },
    };
    const target: ArtPackManifest = {
      ...source,
      name: "@moonlit/scifi-pack",
      // Same ids, different asset content — diffPackSwap matches by id, not by src/anchor equality.
      vehicles: { cart: { src: "vehicles/cart-v2.png", anchor: { x: 30, y: 58 } }, wagon: { src: "vehicles/wagon-v2.png", anchor: { x: 30, y: 58 } } },
    };

    const result = diffPackSwap(source, target);

    expect(result.hasFailures).toBe(false);
    expect(result.findings).toEqual([
      { severity: "ok", message: "2 vehicles map by id" },
      { severity: "ok", message: "2 wagons map by id" },
      { severity: "ok", message: "2 weapons map by id" },
      { severity: "ok", message: "2 VFX effects map by id" },
      { severity: "ok", message: "2 props map by id" },
    ]);
  });

  it("reports FAIL for each category with no equivalent id in the target", () => {
    const source: ArtPackManifest = {
      ...newCategoriesBaseManifest(),
      vehicles: { cart: { src: "vehicles/cart.png", anchor: { x: 32, y: 60 } } },
      wagons: { mule: { src: "wagons/mule.png", anchor: { x: 16, y: 32 } } },
      weapons: { sword: { src: "weapons/sword.png", anchor: { x: 4, y: 28 } } },
      vfx: { spark: { src: "vfx/spark.png", frameCount: 5, fps: 12, anchor: { x: 16, y: 16 } } },
      props: { barrel: { src: "props/barrel.png", anchor: { x: 16, y: 30 } } },
    };
    const target: ArtPackManifest = { ...newCategoriesBaseManifest(), name: "@moonlit/scifi-pack" };

    const result = diffPackSwap(source, target);

    expect(result.hasFailures).toBe(true);
    expect(result.findings).toEqual([
      { severity: "fail", message: "1 vehicle has no equivalent: 'cart'", detail: "These will render as placeholders until remapped." },
      { severity: "fail", message: "1 wagon has no equivalent: 'mule'", detail: "These will render as placeholders until remapped." },
      { severity: "fail", message: "1 weapon has no equivalent: 'sword'", detail: "These will render as placeholders until remapped." },
      { severity: "fail", message: "1 VFX effect has no equivalent: 'spark'", detail: "These will render as placeholders until remapped." },
      { severity: "fail", message: "1 prop has no equivalent: 'barrel'", detail: "These will render as placeholders until remapped." },
    ]);
  });

  it("skips a category entirely when the source declares none of it, even if the target does", () => {
    const source = sourceManifest();
    const target: ArtPackManifest = { ...sourceManifest(), props: { barrel: { src: "props/barrel.png", anchor: { x: 16, y: 30 } } } };

    const result = diffPackSwap(source, target);

    expect(result.findings.some((f) => f.message.includes("prop"))).toBe(false);
  });
});
