import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { diffPackSwap } from "../src/diffPackSwap";
import { validateArtPackManifest } from "../src/validate";

function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let depth = 0; depth < 20; depth++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`findRepoRoot: could not find pnpm-workspace.yaml walking up from '${startDir}'.`);
}

const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readManifest(packDir: string) {
  const raw = readFileSync(join(packDir, "manifest.json"), "utf8");
  return validateArtPackManifest(JSON.parse(raw));
}

/**
 * Three real, checked-in Art Packs — each a manifest.json plus a real
 * PNG, not a stand-in described as one (CLAUDE.md's "never fake it,
 * never write a test that asserts true"). starter-pack and scifi-pack
 * deliberately overlap partially (grass/dirt match, water doesn't) and
 * declare different grid.tileSize values, so together they drive a real
 * diffPackSwap OK/WARN/FAIL result — not just the inline-literal
 * scenarios in diffPackSwap.test.ts. desert-pack exists specifically for
 * the "Remap manually" flow: same grid.tileSize as starter-pack (32, so
 * the pack-aware texture builder's own tile-size-mismatch fallback never
 * masks the remap), but its own missing terrain ('water' again) — the
 * scenario where remapping actually changes what renders, which
 * scifi-pack's mismatched tile size can't demonstrate on its own. All
 * three are what the pack-swap dialog UI's own Playwright tests switch
 * between.
 */
describe.each([
  { name: "starter-pack", dir: join(REPO_ROOT, "fixtures/packs/starter-pack") },
  { name: "scifi-pack", dir: join(REPO_ROOT, "fixtures/packs/scifi-pack") },
  { name: "desert-pack", dir: join(REPO_ROOT, "fixtures/packs/desert-pack") },
])("fixtures/packs/$name", ({ dir }) => {
  it("its manifest.json passes validateArtPackManifest", () => {
    const result = readManifest(dir);
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });

  it("every tileset it declares has a real file on disk at the declared path", () => {
    const result = readManifest(dir);
    expect(result.ok).toBe(true);
    for (const [id, tileset] of Object.entries(result.manifest!.tilesets)) {
      const assetPath = join(dir, tileset.src);
      expect(existsSync(assetPath), `tileset '${id}' declares '${tileset.src}' but no file exists there`).toBe(true);
    }
  });

  it("the declared tileset image is a real, valid PNG, not a placeholder file", () => {
    const bytes = readFileSync(join(dir, "tilesets/outdoor-base.png"));
    expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });
});

describe("fixtures/packs/starter-pack characters", () => {
  const dir = join(REPO_ROOT, "fixtures/packs/starter-pack");

  it("every declared character sheet is a real, valid PNG on disk at the declared path", () => {
    const result = readManifest(dir);
    expect(result.ok).toBe(true);
    const characters = result.manifest!.characters;
    expect(characters).toBeDefined();
    for (const [role, sheetPath] of Object.entries(characters!.sheets)) {
      const assetPath = join(dir, sheetPath);
      expect(existsSync(assetPath), `character sheet '${role}' declares '${sheetPath}' but no file exists there`).toBe(true);
      const bytes = readFileSync(assetPath);
      expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), `character sheet '${role}' is not a valid PNG`).toBe(true);
    }
  });
});

describe("fixtures/packs/starter-pack props (docs/adr/0014, L5)", () => {
  const dir = join(REPO_ROOT, "fixtures/packs/starter-pack");

  it("every declared prop is a real, valid PNG on disk at the declared path", () => {
    const result = readManifest(dir);
    expect(result.ok).toBe(true);
    const props = result.manifest!.props;
    expect(props).toBeDefined();
    expect(Object.keys(props!)).toEqual(["container", "market-stall", "treasure-chest", "dungeon-door"]);
    for (const [id, prop] of Object.entries(props!)) {
      const assetPath = join(dir, prop.src);
      expect(existsSync(assetPath), `prop '${id}' declares '${prop.src}' but no file exists there`).toBe(true);
      const bytes = readFileSync(assetPath);
      expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE), `prop '${id}' is not a valid PNG`).toBe(true);
    }
  });

  it("every declared prop's anchor sits within its own image bounds", () => {
    // The anchor is a pixel coordinate (ArtPackAnchor's own doc comment,
    // manifest.ts) into the specific image it's declared on — a point
    // outside the image's own bounds could never be a real ground-contact
    // point, only a transcription mistake made while writing the manifest.
    const result = readManifest(dir);
    const props = result.manifest!.props!;
    for (const [id, prop] of Object.entries(props)) {
      const bytes = readFileSync(join(dir, prop.src));
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      expect(prop.anchor.x, `prop '${id}' anchor.x`).toBeGreaterThanOrEqual(0);
      expect(prop.anchor.x, `prop '${id}' anchor.x`).toBeLessThanOrEqual(width);
      expect(prop.anchor.y, `prop '${id}' anchor.y`).toBeGreaterThanOrEqual(0);
      expect(prop.anchor.y, `prop '${id}' anchor.y`).toBeLessThanOrEqual(height);
    }
  });
});

describe("diffPackSwap on the two real fixture packs", () => {
  it("starter-pack -> scifi-pack: grass/dirt match, water fails, tile size warns", () => {
    const source = readManifest(join(REPO_ROOT, "fixtures/packs/starter-pack"));
    const target = readManifest(join(REPO_ROOT, "fixtures/packs/scifi-pack"));
    expect(source.ok && target.ok).toBe(true);

    const result = diffPackSwap(source.manifest!, target.manifest!);

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
      {
        severity: "fail",
        message: "3 character sheets have no equivalent: 'hero', 'villager', 'goblin'",
        detail: "These will render as placeholders until remapped.",
      },
      {
        severity: "fail",
        message: "1 animation has no equivalent: 'walk'",
        detail: "These will be skipped until remapped.",
      },
      {
        severity: "fail",
        message: "4 props have no equivalent: 'container', 'market-stall', 'treasure-chest', 'dungeon-door'",
        detail: "These will render as placeholders until remapped.",
      },
    ]);
    expect(result.missingTerrains).toEqual(["water"]);
    expect(result.targetTerrains).toEqual(["dirt", "grass"]);
  });

  it("starter-pack -> desert-pack: same tile size, water still fails, no tile-size warning", () => {
    const source = readManifest(join(REPO_ROOT, "fixtures/packs/starter-pack"));
    const target = readManifest(join(REPO_ROOT, "fixtures/packs/desert-pack"));
    expect(source.ok && target.ok).toBe(true);

    const result = diffPackSwap(source.manifest!, target.manifest!);

    expect(result.hasFailures).toBe(true);
    expect(result.findings).toEqual([
      { severity: "ok", message: "2 tiles map by terrain tag" },
      {
        severity: "fail",
        message: "1 prop has no equivalent: 'water'",
        detail: "These will render as placeholders until remapped.",
      },
      {
        severity: "fail",
        message: "3 character sheets have no equivalent: 'hero', 'villager', 'goblin'",
        detail: "These will render as placeholders until remapped.",
      },
      {
        severity: "fail",
        message: "1 animation has no equivalent: 'walk'",
        detail: "These will be skipped until remapped.",
      },
      {
        severity: "fail",
        message: "4 props have no equivalent: 'container', 'market-stall', 'treasure-chest', 'dungeon-door'",
        detail: "These will render as placeholders until remapped.",
      },
    ]);
    expect(result.missingTerrains).toEqual(["water"]);
    expect(result.targetTerrains).toEqual(["dirt", "grass", "sand"]);
  });
});
