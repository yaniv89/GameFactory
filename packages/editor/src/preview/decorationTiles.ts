import { Graphics, Rectangle, type Renderer, type Texture } from "pixi.js";
import { GRASS_TILE_ID } from "../canvas/tilePalette";

/**
 * H1g's second tilemap layer — real decoration scattered on top of the
 * real, player-painted ground layer, composited by a genuinely separate
 * `TilemapLayer` instance (`PreviewApp.tsx`'s own doc comment on the two
 * layers explains the z-ordering). Unlike `ENEMY_PREFAB`/`COIN_PICKUP_PREFAB`
 * (fixed single spawns, not sourced from anything painted), this layer's
 * *placement* is genuinely derived from the real ground tiles — it reacts
 * to live painting — but its own tile *palette* (what a "Flower" looks
 * like, and the chance one appears) is not yet a player-authored concept:
 * there is no "paint decoration" tool in SceneCanvas, the same stated gap
 * `spawnEnemy`'s own doc comment already accepts for entity placement.
 */
export const FLOWER_DECORATION_ID = 1;
const FLOWER_COLOR = 0xe08fd1; // pink — distinct from every ground/entity/HUD color already in use
/** Roughly one Grass cell in five gets a flower — dense enough to read as real ground cover, sparse enough that it doesn't look like a solid second color fill. */
const FLOWER_CHANCE_PERCENT = 20;

export function buildDecorationTextures(renderer: Renderer, tileSize: number): Map<number, Texture> {
  const textures = new Map<number, Texture>();
  const radius = tileSize * 0.12;
  const graphics = new Graphics().circle(tileSize / 2, tileSize / 2, radius).fill(FLOWER_COLOR);
  // An explicit tileSize x tileSize frame, not the graphics' own (much
  // smaller) local bounds — TilemapLayer positions every layer's sprites
  // by their shared top-left grid coordinate, so a decoration texture
  // needs the same tileSize x tileSize footprint (transparent outside the
  // flower itself) as every ground texture, or it wouldn't line up.
  textures.set(FLOWER_DECORATION_ID, renderer.generateTexture({ target: graphics, frame: new Rectangle(0, 0, tileSize, tileSize) }));
  graphics.destroy();
  return textures;
}

/**
 * A cheap, deterministic integer hash (Robert Jenkins-style bit mixing,
 * the same category of technique already used for spatial hashing in
 * `@forge/core`'s `physics/spatialHash.ts`) — not `Math.random()`, since
 * "does cell (x, y) have a flower" must be stable across repeated calls
 * with the same grid (this is recomputed on every scene-tile message, not
 * cached) rather than flickering to a new pattern on every repaint.
 */
function deterministicPercent(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return Math.abs(h) % 100;
}

/**
 * Derives the decoration layer's own tile grid from the live ground
 * layer: every Grass cell has a deterministic chance of a flower, every
 * other ground tile (Dirt/Water/Wall/empty) never does. Pure — safe to
 * call on every scene-tile message without any decoration-specific state
 * to keep in sync, the ground grid is the only input that matters.
 */
export function computeDecorationTiles(groundTiles: ArrayLike<number>, gridWidth: number, gridHeight: number): number[] {
  const decoration = new Array<number>(gridWidth * gridHeight).fill(0);
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const index = y * gridWidth + x;
      if (groundTiles[index] === GRASS_TILE_ID && deterministicPercent(x, y) < FLOWER_CHANCE_PERCENT) {
        decoration[index] = FLOWER_DECORATION_ID;
      }
    }
  }
  return decoration;
}
