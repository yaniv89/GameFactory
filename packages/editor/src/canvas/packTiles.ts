import { resolveAsset, validateArtPackManifest, type ArtPackManifest } from "@forge/art-pack";
import { Assets, Rectangle, Texture, type Renderer } from "pixi.js";
import { buildPaletteTextures, TILE_PALETTE } from "./tilePalette";

/**
 * Maps a paintable palette entry's label to the terrain tag it should
 * resolve to in an active pack (docs/SPEC.md Section 11.4). Only
 * ground-like tiles participate — "Wall" is deliberately excluded and
 * always stays flat-colored: it drives collision in the walkable
 * preview (`WALL_TILE_ID`), and the Art Pack contract (Section 11.2)
 * has no walkability concept for a declared terrain to carry. Tying
 * collision to pack-declared content would invent semantics the
 * published contract doesn't define — kept out of scope here rather
 * than guessed at.
 */
const PALETTE_TERRAIN_TAGS: Readonly<Record<string, string>> = {
  Grass: "grass",
  Dirt: "dirt",
  Water: "water",
};

export interface ActivePackContext {
  readonly packName: string;
  readonly manifest: ArtPackManifest;
  /** Where this pack's own files are served from — joined with each declared asset path. */
  readonly baseUrl: string;
}

/**
 * There is no real pack registry/install flow yet (M6/M7's marketplace
 * work) — no UI writes anything but this one fixture pack's name into
 * `document.activePack` today, and no code resolves a pack name to a
 * real CDN URL. This is that missing lookup's stand-in, scoped
 * deliberately narrow (one hardcoded entry, dev-server-only static
 * serving — see vite.config.ts's `serveFixturePacks`) so it reads as
 * the placeholder it is rather than something more finished. Replacing
 * it with a real registry lookup is what M6 Phase 4's pack-install UI
 * slice does.
 */
const KNOWN_FIXTURE_PACKS: Readonly<Record<string, { manifestUrl: string; baseUrl: string }>> = {
  "@forge-fixtures/starter-pack": {
    manifestUrl: "/fixture-packs/starter-pack/manifest.json",
    baseUrl: "/fixture-packs/starter-pack",
  },
};

/**
 * Resolves `packName` (`ProjectDocument.activePack`) to a validated
 * manifest, or `undefined` when there's nothing to load (no active
 * pack, an unknown pack name, a fetch failure, or a manifest that fails
 * `validateArtPackManifest`) — every failure path here is a reason to
 * fall back to the default flat-color palette, never a thrown
 * exception, so a broken/misconfigured pack never blocks the canvas
 * from booting at all.
 */
export async function loadActivePackContext(packName: string | undefined): Promise<ActivePackContext | undefined> {
  if (!packName) return undefined;
  const known = KNOWN_FIXTURE_PACKS[packName];
  if (!known) {
    console.warn(`[forge:art-pack] '${packName}' is not a known pack (no registry/install flow exists yet) — falling back to placeholder colors.`);
    return undefined;
  }

  let response: Response;
  try {
    response = await fetch(known.manifestUrl);
  } catch (err) {
    console.warn(`[forge:art-pack] failed to fetch '${packName}' manifest from '${known.manifestUrl}' — falling back to placeholder colors.`, err);
    return undefined;
  }
  if (!response.ok) {
    console.warn(`[forge:art-pack] '${packName}' manifest fetch returned ${response.status} — falling back to placeholder colors.`);
    return undefined;
  }

  const result = validateArtPackManifest(await response.json());
  if (!result.ok) {
    console.warn(`[forge:art-pack] '${packName}' manifest failed validation — falling back to placeholder colors.`, result.errors);
    return undefined;
  }

  return { packName, manifest: result.manifest!, baseUrl: known.baseUrl };
}

/**
 * Builds the same `Map<number, Texture>` shape `buildPaletteTextures`
 * always returns, but with real pack-sourced art substituted in wherever
 * the active pack declares a matching terrain — the ground-palette half
 * of docs/SPEC.md Section 11.4's asset resolution wiring. A palette
 * entry the active pack simply doesn't cover (its `terrains` array is a
 * pack author's own choice, not a contractual obligation to provide
 * every tag this editor's fixed swatch list happens to use) keeps its
 * flat-color default — that is not the "missing reference" case Section
 * 11.4's magenta-placeholder rule is about, so it is not treated as one.
 *
 * What *is* that case: the active pack's own tileset image failing to
 * load (network error, 404, corrupt file). That path is caught and
 * logged as a structured warning — Section 11.4's "never fail silently"
 * — and falls back to the same flat-color texture a "no pack active"
 * world already renders, rather than an invisible or broken tile.
 */
export async function buildPackAwarePaletteTextures(
  renderer: Renderer,
  tileSize: number,
  activePack: ActivePackContext | undefined,
): Promise<Map<number, Texture>> {
  const textures = buildPaletteTextures(renderer, tileSize);
  if (!activePack) return textures;

  // TilemapLayer positions tile sprites but never resizes them (render-2d's
  // own code — no width/height assignment), so a sliced sub-texture
  // renders at its own pixel size, not stretched to fill the grid cell.
  // Slicing at the *pack's* declared grid.tileSize when it doesn't match
  // this layer's tileSize would either crop into the neighboring column
  // (pack tile smaller) or read past this tile's own bounds (pack tile
  // larger) — found as a real bug via the real-browser Playwright test
  // for this (packRendering.spec.ts), not assumed correct. Rescaling
  // mismatched grids is docs/SPEC.md Section 11.5's own "tile size
  // differs... rescaled" pack-swap-diff concern, not something to
  // half-build here — falling back to flat colors is the honest choice
  // until that exists, not a silently broken render.
  if (activePack.manifest.grid.tileSize !== tileSize) {
    console.warn(
      `[forge:art-pack] active pack's grid.tileSize (${activePack.manifest.grid.tileSize}) doesn't match this scene's tile size (${tileSize}) — falling back to placeholder colors until pack-swap rescaling exists.`,
    );
    return textures;
  }

  const tilesetEntries = Object.entries(activePack.manifest.tilesets);
  const firstTileset = tilesetEntries[0];
  if (!firstTileset) return textures; // no ground layer wired yet for a pack that only declares characters/ui/audio.
  const [, tileset] = firstTileset;

  const declaredPaths = new Set(tilesetEntries.map(([, entry]) => entry.src));
  const resolution = resolveAsset(tileset.src, {
    activePackName: activePack.packName,
    // Project overrides/uploads aren't wired yet — no upload UI exists
    // to populate either tier (docs/SPEC.md Section 11.4 tiers 1-2). A
    // stated gap: once that UI exists, these two maps are what it feeds.
    projectOverrides: new Map(),
    projectAssets: new Map(),
    activePack: { baseUrl: activePack.baseUrl, declaredPaths },
    moduleBundledAssets: new Map(),
  });

  if (!resolution.found) {
    console.warn(`[forge:art-pack] '${resolution.assetId}' is not one of the active pack's own declared assets — falling back to placeholder colors.`);
    return textures;
  }

  let sheetTexture: Texture;
  try {
    sheetTexture = await Assets.load<Texture>(resolution.url);
  } catch (err) {
    console.warn(`[forge:art-pack] failed to load tileset image '${resolution.assetId}' (${resolution.url}) — falling back to placeholder colors.`, err);
    return textures;
  }

  for (const entry of TILE_PALETTE) {
    const terrainTag = PALETTE_TERRAIN_TAGS[entry.label];
    if (!terrainTag) continue; // e.g. "Wall" — deliberately never pack-sourced, see this module's own doc comment.
    const columnIndex = tileset.terrains.indexOf(terrainTag);
    if (columnIndex === -1) continue; // this pack doesn't cover that terrain — keep the flat-color default.
    const frame = new Rectangle(columnIndex * tileSize, 0, tileSize, tileSize);
    textures.set(entry.id, new Texture({ source: sheetTexture.source, frame }));
  }

  return textures;
}
