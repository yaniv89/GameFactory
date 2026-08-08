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
 * Two real, checked-in Art Packs — each a manifest.json plus a real PNG,
 * not a stand-in described as one (CLAUDE.md's "never fake it, never
 * write a test that asserts true"). starter-pack and scifi-pack
 * deliberately overlap partially (grass/dirt match, water doesn't) and
 * declare different grid.tileSize values, so together they drive a real
 * diffPackSwap OK/WARN/FAIL result — not just the inline-literal
 * scenarios in diffPackSwap.test.ts — and are what the pack-swap dialog
 * UI's own Playwright test switches between.
 */
describe.each([
  { name: "starter-pack", dir: join(REPO_ROOT, "fixtures/packs/starter-pack") },
  { name: "scifi-pack", dir: join(REPO_ROOT, "fixtures/packs/scifi-pack") },
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
    ]);
  });
});
