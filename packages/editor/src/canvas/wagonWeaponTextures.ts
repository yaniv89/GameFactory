import { resolveAsset } from "@forge/art-pack";
import { Assets, Rectangle, Texture } from "pixi.js";
import type { ActivePackContext } from "./packTiles";

/**
 * docs/adr/0014's `wagons` category — a 1x4 facing strip (south, west,
 * east, north; `tools/art-pipeline/sprite_strip_slicer.py`'s own column
 * order), sliced the same way `characterTextures.ts` slices a walk-cycle
 * sheet, except a wagon/mount has exactly one frame per facing rather
 * than a walk cycle: `frames[0..3]` are south/west/east/north, full
 * stop, not `frames[facing * frameCount + frameInRow]`.
 *
 * `Mount`'s current `Sprite.frame` is always `0` (`MOUNT_PREFAB`'s own
 * fixed `sprite: { frame: 0, ... }` — nothing drives it off `Animator`
 * yet, since a mount has no `Animator` component today), so callers use
 * `frames[0]` (south) until #139 gives a placed mount real facing.
 */
export interface WagonFrameSet {
  readonly frames: readonly Texture[];
}

/**
 * Resolves every wagon/mount asset an active pack declares into a sliced
 * 4-frame set, keyed by the pack author's own chosen id (`wagons`' own
 * keys, e.g. `"mount"`) — same five-tier `resolveAsset` call, same
 * "never throw, log and fall back" contract as
 * `buildPackAwareCharacterTextures`. Returns an empty map (never throws)
 * when there's no active pack, it declares no `wagons` section, or it
 * has no `grid.spriteSize` — a pack this old/minimal has no wagon art
 * yet, same "falls back to the flat marker" honesty as a missing tileset.
 */
export async function buildPackAwareWagonTextures(activePack: ActivePackContext | undefined): Promise<Map<string, WagonFrameSet>> {
  const result = new Map<string, WagonFrameSet>();
  const wagons = activePack?.manifest.wagons;
  if (!activePack || !wagons) return result;

  const frameSize = activePack.manifest.grid.spriteSize ?? { width: activePack.manifest.grid.tileSize, height: activePack.manifest.grid.tileSize };

  const declaredPaths = new Set(Object.values(wagons).map((wagon) => wagon.src));

  for (const [wagonId, wagon] of Object.entries(wagons)) {
    const resolution = resolveAsset(wagon.src, {
      activePackName: activePack.packName,
      projectOverrides: new Map(),
      projectAssets: new Map(),
      activePack: { baseUrl: activePack.baseUrl, declaredPaths },
      moduleBundledAssets: new Map(),
    });
    if (!resolution.found) {
      console.warn(`[forge:art-pack] '${resolution.assetId}' is not one of '${activePack.packName}'s own declared assets — falling back to a flat marker for wagon '${wagonId}'.`);
      continue;
    }

    let stripTexture: Texture;
    try {
      stripTexture = await Assets.load<Texture>(resolution.url);
    } catch (err) {
      console.warn(`[forge:art-pack] failed to load wagon strip '${resolution.assetId}' (${resolution.url}) — falling back to a flat marker for wagon '${wagonId}'.`, err);
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
 * docs/adr/0014's `weapons` category — one flat icon per weapon id, no
 * slicing (unlike `wagons`/`characters`, a weapon asset is already the
 * whole image `chroma_key_extract.py` produced). `createEquipmentSystem`
 * takes a single `weaponAssetId` regardless of which item is equipped
 * (that system's own doc comment: "`@forge/core` has no notion of
 * sprite-key resolution"), so every caller resolves exactly one weapon
 * id today — this still returns the full declared map, keyed by the
 * pack author's own chosen id, so a caller can pick whichever key its
 * convention agrees on (this repo's own convention: `"sword"`).
 */
export async function buildPackAwareWeaponTextures(activePack: ActivePackContext | undefined): Promise<Map<string, Texture>> {
  const result = new Map<string, Texture>();
  const weapons = activePack?.manifest.weapons;
  if (!activePack || !weapons) return result;

  const declaredPaths = new Set(Object.values(weapons).map((weapon) => weapon.src));

  for (const [weaponId, weapon] of Object.entries(weapons)) {
    const resolution = resolveAsset(weapon.src, {
      activePackName: activePack.packName,
      projectOverrides: new Map(),
      projectAssets: new Map(),
      activePack: { baseUrl: activePack.baseUrl, declaredPaths },
      moduleBundledAssets: new Map(),
    });
    if (!resolution.found) {
      console.warn(`[forge:art-pack] '${resolution.assetId}' is not one of '${activePack.packName}'s own declared assets — falling back to a flat marker for weapon '${weaponId}'.`);
      continue;
    }

    try {
      result.set(weaponId, await Assets.load<Texture>(resolution.url));
    } catch (err) {
      console.warn(`[forge:art-pack] failed to load weapon icon '${resolution.assetId}' (${resolution.url}) — falling back to a flat marker for weapon '${weaponId}'.`, err);
    }
  }

  return result;
}
