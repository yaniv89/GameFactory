import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
const FIXTURE_PACK_DIR = join(REPO_ROOT, "fixtures/packs/starter-pack");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * fixtures/packs/starter-pack is a real, checked-in Art Pack — a
 * manifest.json plus a real PNG, not a stand-in described as one
 * (CLAUDE.md's "never fake it, never write a test that asserts true").
 * This is what a future asset-resolution/pack-swap-diff integration
 * test resolves real assets against, so its own integrity (does the
 * manifest actually validate, does every path it declares actually
 * exist on disk) is worth verifying directly, not assumed.
 */
describe("fixtures/packs/starter-pack", () => {
  it("its manifest.json passes validateArtPackManifest", () => {
    const raw = readFileSync(join(FIXTURE_PACK_DIR, "manifest.json"), "utf8");
    const result = validateArtPackManifest(JSON.parse(raw));
    expect(result.ok, JSON.stringify(result.errors)).toBe(true);
  });

  it("every tileset it declares has a real file on disk at the declared path", () => {
    const raw = readFileSync(join(FIXTURE_PACK_DIR, "manifest.json"), "utf8");
    const result = validateArtPackManifest(JSON.parse(raw));
    expect(result.ok).toBe(true);
    for (const [id, tileset] of Object.entries(result.manifest!.tilesets)) {
      const assetPath = join(FIXTURE_PACK_DIR, tileset.src);
      expect(existsSync(assetPath), `tileset '${id}' declares '${tileset.src}' but no file exists there`).toBe(true);
    }
  });

  it("the declared tileset image is a real, valid PNG, not a placeholder file", () => {
    const bytes = readFileSync(join(FIXTURE_PACK_DIR, "tilesets/outdoor-base.png"));
    expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  });
});
