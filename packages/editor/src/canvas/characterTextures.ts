import { resolveAsset } from "@forge/art-pack";
import { Assets, Rectangle, Texture } from "pixi.js";
import type { ActivePackContext } from "./packTiles";

/**
 * Every frame of a character's walk cycle, indexed exactly the way
 * `createCharacterAnimationSystem` (`@forge/core`) computes `Sprite.frame`:
 * row-major, row = facing (0 south, 1 west, 2 east, 3 north), column = the
 * walk cycle's frame-in-row. `frames[sprite.frame]` is always the right
 * texture — no separate row/column math on the caller's side.
 */
export interface CharacterFrameSet {
  readonly frames: readonly Texture[];
}

/**
 * Resolves every character sheet an active pack declares (docs/adr/0014)
 * into sliced, per-frame textures — the character half of
 * `buildPackAwarePaletteTextures`'s own pattern (same five-tier
 * `resolveAsset` call, same "never throw, log and fall back" contract).
 * Keyed by the pack author's own role id (`characters.sheets`' keys, e.g.
 * `"hero"`) — callers own mapping a prefab/entity to a role, this function
 * only resolves art.
 *
 * Returns an empty map (never throws) when there's no active pack, the
 * pack declares no `characters` section, or it declares one with no
 * `grid.spriteSize` — a pack this old/minimal simply has no character art
 * yet, same "falls back to the placeholder" honesty as a missing tileset.
 */
export async function buildPackAwareCharacterTextures(activePack: ActivePackContext | undefined): Promise<Map<string, CharacterFrameSet>> {
  const result = new Map<string, CharacterFrameSet>();
  const characters = activePack?.manifest.characters;
  if (!activePack || !characters) return result;

  const spriteSize = activePack.manifest.grid.spriteSize;
  if (!spriteSize) {
    console.warn(`[forge:art-pack] '${activePack.packName}' declares 'characters' but no 'grid.spriteSize' — character sheets can't be sliced, falling back to placeholder markers.`);
    return result;
  }

  const walkAnimation = characters.template.animations["walk"];
  if (!walkAnimation) {
    console.warn(`[forge:art-pack] '${activePack.packName}' declares 'characters' but no 'walk' animation — falling back to placeholder markers.`);
    return result;
  }

  const declaredPaths = new Set(Object.values(characters.sheets));

  for (const [role, path] of Object.entries(characters.sheets)) {
    const resolution = resolveAsset(path, {
      activePackName: activePack.packName,
      projectOverrides: new Map(),
      projectAssets: new Map(),
      activePack: { baseUrl: activePack.baseUrl, declaredPaths },
      moduleBundledAssets: new Map(),
    });
    if (!resolution.found) {
      console.warn(`[forge:art-pack] '${resolution.assetId}' is not one of '${activePack.packName}'s own declared assets — falling back to placeholder marker for role '${role}'.`);
      continue;
    }

    let sheetTexture: Texture;
    try {
      sheetTexture = await Assets.load<Texture>(resolution.url);
    } catch (err) {
      console.warn(`[forge:art-pack] failed to load character sheet '${resolution.assetId}' (${resolution.url}) — falling back to placeholder marker for role '${role}'.`, err);
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
