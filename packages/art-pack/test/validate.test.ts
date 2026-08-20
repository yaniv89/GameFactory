import { describe, expect, it } from "vitest";
import { validateArtPackManifest } from "../src/validate";

/** docs/SPEC.md Section 11.2's own example, verbatim. */
function validManifest(): unknown {
  return {
    schemaVersion: 2,
    name: "@pixelfoundry/fantasy-pack",
    version: "4.2.0",
    kind: "artpack",
    engine: ">=2.0.0 <3.0.0",
    grid: { tileSize: 32, spriteSize: { width: 32, height: 48 } },
    implements: ["forge/topdown-rpg-basic@1", "forge/topdown-rpg-combat@1"],
    tilesets: {
      "outdoor-base": {
        src: "tilesets/outdoor-base.png",
        columns: 16,
        terrains: ["grass", "dirt", "water", "sand", "stone"],
        autotile: "wang-2corner",
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
    ui: {
      skin: "ui/skin.9slice.json",
      font: { family: "ui/pixel.woff2", baseSize: 16, lineHeight: 1.4 },
      palette: {
        bg: "#1a1420",
        panel: "#2d2438",
        text: "#f0e6d2",
        accent: "#d4a017",
        danger: "#c1445a",
      },
    },
    audio: {
      sfx: { "menu-select": "audio/select.ogg", hit: "audio/hit.ogg" },
      music: { "village-theme": "audio/village.ogg" },
    },
    locales: ["en"],
    attribution: { required: true, text: "Art by PixelFoundry (CC-BY-4.0)" },
  };
}

describe("validateArtPackManifest: docs/SPEC.md Section 11.2's example manifest", () => {
  it("accepts the spec's own example verbatim", () => {
    const result = validateArtPackManifest(validManifest());
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.manifest?.name).toBe("@pixelfoundry/fantasy-pack");
    expect(result.manifest?.tilesets["outdoor-base"]?.terrains).toEqual(["grass", "dirt", "water", "sand", "stone"]);
  });

  it("accepts a minimal manifest with only the required fields", () => {
    const minimal = {
      schemaVersion: 1,
      name: "@acme/minimal-pack",
      version: "1.0.0",
      kind: "artpack",
      engine: ">=1.0.0 <2.0.0",
      grid: { tileSize: 16 },
      implements: ["forge/topdown-rpg-basic@1"],
      tilesets: { base: { src: "base.png", columns: 4, terrains: ["grass"] } },
      locales: ["en"],
    };
    const result = validateArtPackManifest(minimal);
    expect(result.ok).toBe(true);
    expect(result.manifest?.characters).toBeUndefined();
    expect(result.manifest?.ui).toBeUndefined();
    expect(result.manifest?.audio).toBeUndefined();
  });
});

describe("validateArtPackManifest: rejects malformed input", () => {
  it("rejects a non-object", () => {
    const result = validateArtPackManifest("not an object");
    expect(result.ok).toBe(false);
    expect(result.errors["manifest"]).toBeDefined();
  });

  it("rejects a missing/wrong kind", () => {
    const result = validateArtPackManifest({ ...validManifest() as object, kind: "module" });
    expect(result.ok).toBe(false);
    expect(result.errors["kind"]).toBeDefined();
  });

  it("rejects an unscoped name", () => {
    const result = validateArtPackManifest({ ...validManifest() as object, name: "fantasy-pack" });
    expect(result.ok).toBe(false);
    expect(result.errors["name"]).toBeDefined();
  });

  it("rejects a non-semver version", () => {
    const result = validateArtPackManifest({ ...validManifest() as object, version: "latest" });
    expect(result.ok).toBe(false);
    expect(result.errors["version"]).toBeDefined();
  });

  it("rejects an empty implements array", () => {
    const result = validateArtPackManifest({ ...validManifest() as object, implements: [] });
    expect(result.ok).toBe(false);
    expect(result.errors["implements"]).toBeDefined();
  });

  it("rejects a non-positive grid.tileSize", () => {
    const result = validateArtPackManifest({ ...validManifest() as object, grid: { tileSize: 0 } });
    expect(result.ok).toBe(false);
    expect(result.errors["grid.tileSize"]).toBeDefined();
  });

  it("rejects an empty tilesets object", () => {
    const result = validateArtPackManifest({ ...validManifest() as object, tilesets: {} });
    expect(result.ok).toBe(false);
    expect(result.errors["tilesets"]).toBeDefined();
  });

  it("rejects a tileset missing terrains", () => {
    const manifest = validManifest() as Record<string, unknown>;
    const result = validateArtPackManifest({
      ...manifest,
      tilesets: { base: { src: "base.png", columns: 4, terrains: [] } },
    });
    expect(result.ok).toBe(false);
    expect(result.errors["tilesets.base.terrains"]).toBeDefined();
  });

  it("rejects a UI palette with a non-hex color", () => {
    const manifest = validManifest() as Record<string, unknown>;
    const ui = manifest["ui"] as Record<string, unknown>;
    const result = validateArtPackManifest({
      ...manifest,
      ui: { ...ui, palette: { bg: "not-a-color" } },
    });
    expect(result.ok).toBe(false);
    expect(result.errors["ui.palette.bg"]).toBeDefined();
  });

  it("rejects audio with neither sfx nor music", () => {
    const result = validateArtPackManifest({ ...validManifest() as object, audio: {} });
    expect(result.ok).toBe(false);
    expect(result.errors["audio"]).toBeDefined();
  });

  it("rejects attribution.required=true with empty text", () => {
    const result = validateArtPackManifest({ ...validManifest() as object, attribution: { required: true, text: "" } });
    expect(result.ok).toBe(false);
    expect(result.errors["attribution.text"]).toBeDefined();
  });

  it("collects multiple field errors in one pass rather than stopping at the first", () => {
    const result = validateArtPackManifest({ kind: "module" });
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).length).toBeGreaterThan(3);
  });
});

describe("validateArtPackManifest: docs/adr/0014's five new asset categories", () => {
  it("accepts a manifest declaring all five, and omits all five from a manifest declaring none", () => {
    const manifest = validManifest() as Record<string, unknown>;
    const withNewCategories = {
      ...manifest,
      vehicles: { cart: { src: "vehicles/cart.png", anchor: { x: 32, y: 60 } } },
      wagons: { mule: { src: "wagons/mule.png", anchor: { x: 16, y: 32 } } },
      weapons: { sword: { src: "weapons/sword.png", anchor: { x: 4, y: 28 } } },
      vfx: { spark: { src: "vfx/spark.png", frameCount: 5, fps: 12, anchor: { x: 16, y: 16 } } },
      props: { barrel: { src: "props/barrel.png", anchor: { x: 16, y: 30 } } },
    };
    const result = validateArtPackManifest(withNewCategories);
    expect(result.ok).toBe(true);
    expect(result.manifest?.vehicles).toEqual({ cart: { src: "vehicles/cart.png", anchor: { x: 32, y: 60 } } });
    expect(result.manifest?.wagons).toEqual({ mule: { src: "wagons/mule.png", anchor: { x: 16, y: 32 } } });
    expect(result.manifest?.weapons).toEqual({ sword: { src: "weapons/sword.png", anchor: { x: 4, y: 28 } } });
    expect(result.manifest?.vfx).toEqual({ spark: { src: "vfx/spark.png", frameCount: 5, fps: 12, anchor: { x: 16, y: 16 } } });
    expect(result.manifest?.props).toEqual({ barrel: { src: "props/barrel.png", anchor: { x: 16, y: 30 } } });

    const withoutNewCategories = validateArtPackManifest(manifest);
    expect(withoutNewCategories.ok).toBe(true);
    expect(withoutNewCategories.manifest?.vehicles).toBeUndefined();
    expect(withoutNewCategories.manifest?.wagons).toBeUndefined();
    expect(withoutNewCategories.manifest?.weapons).toBeUndefined();
    expect(withoutNewCategories.manifest?.vfx).toBeUndefined();
    expect(withoutNewCategories.manifest?.props).toBeUndefined();
  });

  it.each(["vehicles", "wagons", "weapons", "props"] as const)("rejects an empty %s object", (category) => {
    const result = validateArtPackManifest({ ...(validManifest() as object), [category]: {} });
    expect(result.ok).toBe(false);
    expect(result.errors[category]).toBeDefined();
  });

  it.each(["vehicles", "wagons", "weapons", "props"] as const)("rejects a %s entry missing src", (category) => {
    const result = validateArtPackManifest({ ...(validManifest() as object), [category]: { a: { anchor: { x: 0, y: 0 } } } });
    expect(result.ok).toBe(false);
    expect(result.errors[`${category}.a.src`]).toBeDefined();
  });

  it.each(["vehicles", "wagons", "weapons", "props"] as const)("rejects a %s entry missing anchor", (category) => {
    const result = validateArtPackManifest({ ...(validManifest() as object), [category]: { a: { src: "a.png" } } });
    expect(result.ok).toBe(false);
    expect(result.errors[`${category}.a.anchor`]).toBeDefined();
  });

  it.each(["vehicles", "wagons", "weapons", "props"] as const)("rejects a %s entry with a non-numeric anchor field", (category) => {
    const result = validateArtPackManifest({ ...(validManifest() as object), [category]: { a: { src: "a.png", anchor: { x: "0", y: 0 } } } });
    expect(result.ok).toBe(false);
    expect(result.errors[`${category}.a.anchor`]).toBeDefined();
  });

  it("rejects an empty vfx object", () => {
    const result = validateArtPackManifest({ ...(validManifest() as object), vfx: {} });
    expect(result.ok).toBe(false);
    expect(result.errors["vfx"]).toBeDefined();
  });

  it("rejects a vfx entry missing frameCount", () => {
    const result = validateArtPackManifest({ ...(validManifest() as object), vfx: { spark: { src: "spark.png", fps: 12, anchor: { x: 0, y: 0 } } } });
    expect(result.ok).toBe(false);
    expect(result.errors["vfx.spark.frameCount"]).toBeDefined();
  });

  it("rejects a vfx entry with a non-positive frameCount", () => {
    const result = validateArtPackManifest({
      ...(validManifest() as object),
      vfx: { spark: { src: "spark.png", frameCount: 0, fps: 12, anchor: { x: 0, y: 0 } } },
    });
    expect(result.ok).toBe(false);
    expect(result.errors["vfx.spark.frameCount"]).toBeDefined();
  });

  it("rejects a vfx entry missing fps", () => {
    const result = validateArtPackManifest({
      ...(validManifest() as object),
      vfx: { spark: { src: "spark.png", frameCount: 5, anchor: { x: 0, y: 0 } } },
    });
    expect(result.ok).toBe(false);
    expect(result.errors["vfx.spark.fps"]).toBeDefined();
  });

  it("rejects a vfx entry missing anchor", () => {
    const result = validateArtPackManifest({ ...(validManifest() as object), vfx: { spark: { src: "spark.png", frameCount: 5, fps: 12 } } });
    expect(result.ok).toBe(false);
    expect(result.errors["vfx.spark.anchor"]).toBeDefined();
  });

  it("collects errors across multiple entries in the same category rather than stopping at the first", () => {
    const result = validateArtPackManifest({
      ...(validManifest() as object),
      props: { barrel: { src: "barrel.png", anchor: { x: 0, y: 0 } }, crate: { anchor: { x: 0, y: 0 } } },
    });
    expect(result.ok).toBe(false);
    expect(result.errors["props.crate.src"]).toBeDefined();
  });
});
