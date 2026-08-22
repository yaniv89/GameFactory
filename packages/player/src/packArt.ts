import { Assets, Rectangle, Texture, type Renderer } from "pixi.js";
import type { PlayerPackData } from "./playerProjectData.js";
import { buildPaletteTextures, TILE_PALETTE } from "./tilePalette.js";

/**
 * K1 Phase 2b: the standalone player's own real Art Pack rendering,
 * mirroring `packages/editor/src/canvas/packTiles.ts`'s and
 * `packages/editor/src/canvas/characterTextures.ts`'s pack-aware texture
 * builders — same terrain-tag mapping, same "never throw, log and fall
 * back to the flat placeholder" contract — but reading pre-resolved,
 * already-embedded `data:` URIs off `PlayerProjectData.pack.assets`
 * (`resolvePackData`, packages/cli/src/commands/export.ts) instead of
 * fetching a dev-server URL through `@forge/art-pack`'s `resolveAsset`.
 * There is nothing left to *resolve* at this point — the CLI already
 * decided, at export time, which declared paths this build actually has
 * bytes for; this module's only job is slicing those bytes into textures.
 */

/** Matches packTiles.ts's own mapping exactly — "Wall" is deliberately excluded, same reasoning as that module's own doc comment (no walkability concept in the Art Pack contract). */
const PALETTE_TERRAIN_TAGS: Readonly<Record<string, string>> = {
  Grass: "grass",
  Dirt: "dirt",
  Water: "water",
};

export async function buildPlayerPaletteTextures(renderer: Renderer, tileSize: number, pack: PlayerPackData | undefined): Promise<Map<number, Texture>> {
  const textures = buildPaletteTextures(renderer, tileSize);
  if (!pack) return textures;

  if (pack.manifest.grid.tileSize !== tileSize) {
    console.warn(
      `[forge:player] active pack's grid.tileSize (${pack.manifest.grid.tileSize}) doesn't match this scene's tile size (${tileSize}) — falling back to placeholder colors.`,
    );
    return textures;
  }

  const firstTileset = Object.values(pack.manifest.tilesets)[0];
  if (!firstTileset) return textures; // no ground layer this pack declares.
  const dataUrl = pack.assets[firstTileset.src];
  if (!dataUrl) return textures; // not embedded at export time (resolvePackData already warned about it).

  let sheetTexture: Texture;
  try {
    sheetTexture = await Assets.load<Texture>(dataUrl);
  } catch (err) {
    console.warn(`[forge:player] failed to decode the embedded tileset image '${firstTileset.src}' — falling back to placeholder colors.`, err);
    return textures;
  }

  for (const entry of TILE_PALETTE) {
    const terrainTag = PALETTE_TERRAIN_TAGS[entry.label];
    if (!terrainTag) continue;
    const columnIndex = firstTileset.terrains.indexOf(terrainTag);
    if (columnIndex === -1) continue; // this pack doesn't cover that terrain — keep the flat-color default.
    const frame = new Rectangle(columnIndex * tileSize, 0, tileSize, tileSize);
    textures.set(entry.id, new Texture({ source: sheetTexture.source, frame }));
  }

  return textures;
}

export interface PlayerCharacterFrameSet {
  readonly frames: readonly Texture[];
}

/** Returns an empty map (never throws) when there's no active pack, it declares no `characters`, or no `grid.spriteSize`/`walk` animation to slice by — same "this pack simply has no character art yet" honesty `characterTextures.ts`'s own doc comment states. */
export async function buildPlayerCharacterTextures(pack: PlayerPackData | undefined): Promise<Map<string, PlayerCharacterFrameSet>> {
  const result = new Map<string, PlayerCharacterFrameSet>();
  const characters = pack?.manifest.characters;
  if (!pack || !characters) return result;

  const spriteSize = pack.manifest.grid.spriteSize;
  if (!spriteSize) {
    console.warn(`[forge:player] '${pack.name}' declares 'characters' but no 'grid.spriteSize' — character sheets can't be sliced, falling back to placeholder markers.`);
    return result;
  }
  const walkAnimation = characters.template.animations["walk"];
  if (!walkAnimation) {
    console.warn(`[forge:player] '${pack.name}' declares 'characters' but no 'walk' animation — falling back to placeholder markers.`);
    return result;
  }

  for (const [role, path] of Object.entries(characters.sheets)) {
    const dataUrl = pack.assets[path];
    if (!dataUrl) continue; // not embedded at export time — falls back to the placeholder marker for this role.

    let sheetTexture: Texture;
    try {
      sheetTexture = await Assets.load<Texture>(dataUrl);
    } catch (err) {
      console.warn(`[forge:player] failed to decode the embedded character sheet '${path}' for role '${role}' — falling back to a placeholder marker.`, err);
      continue;
    }

    const frames: Texture[] = [];
    for (let row = 0; row < walkAnimation.directions; row++) {
      for (let col = 0; col < walkAnimation.frames; col++) {
        const frame = new Rectangle(col * spriteSize.width, row * spriteSize.height, spriteSize.width, spriteSize.height);
        frames.push(new Texture({ source: sheetTexture.source, frame }));
      }
    }
    result.set(role, { frames });
  }

  return result;
}

/**
 * K1 Phase 2's wagon/mount half — mirrors
 * `packages/editor/src/canvas/wagonWeaponTextures.ts`'s
 * `buildPackAwareWagonTextures` exactly (a 1x4 south/west/east/north
 * facing strip, `frames[0]` = south, the only frame a placed Mount's
 * fixed `Sprite.frame = 0` ever asks for today), reading pre-resolved
 * `pack.assets` data URIs instead of fetching through `resolveAsset`.
 */
export interface PlayerWagonFrameSet {
  readonly frames: readonly Texture[];
}

export async function buildPlayerWagonTextures(pack: PlayerPackData | undefined): Promise<Map<string, PlayerWagonFrameSet>> {
  const result = new Map<string, PlayerWagonFrameSet>();
  const wagons = pack?.manifest.wagons;
  if (!pack || !wagons) return result;

  const frameSize = pack.manifest.grid.spriteSize ?? { width: pack.manifest.grid.tileSize, height: pack.manifest.grid.tileSize };

  for (const [wagonId, wagon] of Object.entries(wagons)) {
    const dataUrl = pack.assets[wagon.src];
    if (!dataUrl) continue; // not embedded at export time — falls back to the flat marker for this wagon.

    let stripTexture: Texture;
    try {
      stripTexture = await Assets.load<Texture>(dataUrl);
    } catch (err) {
      console.warn(`[forge:player] failed to decode the embedded wagon strip '${wagon.src}' for '${wagonId}' — falling back to a flat marker.`, err);
      continue;
    }

    const frames: Texture[] = [];
    for (let column = 0; column < 4; column++) {
      const frame = new Rectangle(column * frameSize.width, 0, frameSize.width, frameSize.height);
      frames.push(new Texture({ source: stripTexture.source, frame }));
    }
    result.set(wagonId, { frames });
  }

  return result;
}

/**
 * K1 Phase 2's weapon half — mirrors
 * `buildPackAwareWeaponTextures` exactly (one flat icon per weapon id,
 * no slicing), reading pre-resolved `pack.assets` data URIs.
 */
export async function buildPlayerWeaponTextures(pack: PlayerPackData | undefined): Promise<Map<string, Texture>> {
  const result = new Map<string, Texture>();
  const weapons = pack?.manifest.weapons;
  if (!pack || !weapons) return result;

  for (const [weaponId, weapon] of Object.entries(weapons)) {
    const dataUrl = pack.assets[weapon.src];
    if (!dataUrl) continue; // not embedded at export time — falls back to the flat marker for this weapon.

    try {
      result.set(weaponId, await Assets.load<Texture>(dataUrl));
    } catch (err) {
      console.warn(`[forge:player] failed to decode the embedded weapon icon '${weapon.src}' for '${weaponId}' — falling back to a flat marker.`, err);
    }
  }

  return result;
}
