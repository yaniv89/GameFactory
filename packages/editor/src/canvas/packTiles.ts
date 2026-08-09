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
  "@forge-fixtures/scifi-pack": {
    manifestUrl: "/fixture-packs/scifi-pack/manifest.json",
    baseUrl: "/fixture-packs/scifi-pack",
  },
  "@forge-fixtures/desert-pack": {
    manifestUrl: "/fixture-packs/desert-pack/manifest.json",
    baseUrl: "/fixture-packs/desert-pack",
  },
};

/**
 * Every pack name the pack-swap dialog (docs/SPEC.md Section 11.5) can
 * offer as a switch target — today, exactly `KNOWN_FIXTURE_PACKS`' own
 * keys, since there's no registry to browse yet. The dialog imports this
 * instead of the map itself so that map can stay module-private.
 */
export function listKnownPackNames(): readonly string[] {
  return Object.keys(KNOWN_FIXTURE_PACKS);
}

/**
 * `loadActivePackContext`'s "why didn't this work" — collapsed to
 * `undefined` by that function (a broken/misconfigured pack must never
 * block the canvas from booting), but the pack-swap dialog needs the
 * distinction: a network failure is retryable (Panel's "offline" state),
 * an unknown name or a manifest that fails validation is not (Panel's
 * "error" state) — CLAUDE.md 5.5's "what happened, why, what to do
 * next" doesn't hold for a message that conflates "try again" with
 * "this pack is broken."
 */
export type PackManifestLoadResult =
  | { readonly ok: true; readonly packName: string; readonly manifest: ArtPackManifest; readonly baseUrl: string }
  | { readonly ok: false; readonly kind: "unknown-pack" | "invalid-manifest"; readonly message: string }
  | { readonly ok: false; readonly kind: "network"; readonly message: string };

/**
 * Fetches and validates `packName`'s manifest, distinguishing *why* it
 * failed. `loadActivePackContext` below is this with every failure
 * collapsed to `undefined`, for callers (canvas boot) that only care
 * about "did it work."
 */
export async function loadPackManifest(packName: string): Promise<PackManifestLoadResult> {
  const known = KNOWN_FIXTURE_PACKS[packName];
  if (!known) {
    return {
      ok: false,
      kind: "unknown-pack",
      message: `'${packName}' is not a known pack — there is no registry/install flow yet, only this hardcoded fixture list.`,
    };
  }

  let response: Response;
  try {
    response = await fetch(known.manifestUrl);
  } catch (err) {
    return { ok: false, kind: "network", message: err instanceof Error ? err.message : String(err) };
  }
  if (!response.ok) {
    return { ok: false, kind: "network", message: `Manifest fetch returned HTTP ${response.status}.` };
  }

  const result = validateArtPackManifest(await response.json());
  if (!result.ok) {
    return { ok: false, kind: "invalid-manifest", message: JSON.stringify(result.errors) };
  }

  return { ok: true, packName, manifest: result.manifest!, baseUrl: known.baseUrl };
}

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
  const result = await loadPackManifest(packName);
  if (!result.ok) {
    console.warn(`[forge:art-pack] '${packName}' failed to load (${result.kind}): ${result.message} — falling back to placeholder colors.`);
    return undefined;
  }
  return { packName: result.packName, manifest: result.manifest, baseUrl: result.baseUrl };
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
  /**
   * docs/SPEC.md Section 11.5's "Remap manually" — a source terrain tag
   * -> the substitute tag to use when `activePack` doesn't declare the
   * original (`document.packTerrainRemap`). Checked only as a fallback
   * once the tag's own column lookup misses, so a pack that *does*
   * cover a tag is never second-guessed by a stale remap entry left
   * over from a different pack.
   */
  terrainRemap: Readonly<Record<string, string>>,
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
    let columnIndex = tileset.terrains.indexOf(terrainTag);
    if (columnIndex === -1) {
      const remappedTag = terrainRemap[terrainTag];
      if (remappedTag) columnIndex = tileset.terrains.indexOf(remappedTag);
    }
    if (columnIndex === -1) continue; // this pack doesn't cover that terrain, remapped or not — keep the flat-color default.
    const frame = new Rectangle(columnIndex * tileSize, 0, tileSize, tileSize);
    textures.set(entry.id, new Texture({ source: sheetTexture.source, frame }));
  }

  return textures;
}
