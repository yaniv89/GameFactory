import { AUTOTILE_EAST, AUTOTILE_NORTH, AUTOTILE_SOUTH, AUTOTILE_VARIANT_COUNT, AUTOTILE_WEST } from "@forge/render-2d";
import { Graphics, type Renderer, type Texture } from "pixi.js";

/**
 * Placeholder tile art — flat colors, not tokens.css values. CLAUDE.md
 * 5.2's "every color comes from tokens" governs editor UI chrome; the
 * scene canvas's own content is a separate visual language by design
 * (5.7: "the scene canvas does not [mirror]... game world coordinates
 * are absolute"). There is no Art Pack system yet (M6), so this is
 * genuinely what tile art is right now, not a stand-in presented as
 * something more finished.
 */
export interface PaletteEntry {
  readonly id: number;
  readonly label: string;
  readonly color: number;
}

export const TILE_PALETTE: readonly PaletteEntry[] = [
  { id: 1, label: "Grass", color: 0x4a7c3c },
  { id: 2, label: "Dirt", color: 0x8b5a2b },
  { id: 3, label: "Water", color: 0x3a6ea5 },
  { id: 4, label: "Wall", color: 0x6b6b6b },
];

/** The one tile id the walkable preview (Phase 7) treats as solid. */
export const WALL_TILE_ID = 4;

/** H1g's decoration layer scatters flowers only on this ground tile — see `decorationTiles.ts`'s own doc comment. */
export const GRASS_TILE_ID = 1;

/**
 * One real Pixi Texture per palette color, generated once via a GPU
 * render pass (`renderer.generateTexture`) — not a data: URI or canvas
 * hack, the same texture-generation path a real tileset atlas cut would
 * use. Keyed by tile id so `TilemapLayer.resolveTileTexture` (docs:
 * packages/render-2d/src/tilemapLayer.ts) can look them up directly.
 */
export function buildPaletteTextures(renderer: Renderer, tileSize: number): Map<number, Texture> {
  const textures = new Map<number, Texture>();
  for (const entry of TILE_PALETTE) {
    const graphics = new Graphics().rect(0, 0, tileSize, tileSize).fill(entry.color);
    textures.set(entry.id, renderer.generateTexture(graphics));
    graphics.destroy();
  }
  return textures;
}

/** A lighter shade of the Wall swatch — H1g's autotile edge highlight, drawn only on a wall cell's own exposed sides (`@forge/render-2d`'s `computeAutotileBitmask`: a bit *unset* means that side has no matching wall neighbor). Not a token: game-world content, same "flat colors, not tokens.css" reasoning as `TILE_PALETTE` itself. */
const WALL_AUTOTILE_EDGE_COLOR = 0x9a9a9a;

/**
 * H1g's real autotiling: one distinct Wall texture per possible 4-neighbor
 * bitmask (0–15) — an isolated wall block shows a highlighted edge on
 * every side, a wall that's part of a solid run shows highlights only on
 * the sides actually facing open space, and a wall fully enclosed by
 * other walls (interior, never player-visible) shows none. Keyed by the
 * bitmask itself, not a tile id — the caller (`resolveTileTexture` in the
 * live preview) computes each cell's own bitmask from the live grid and
 * looks the result up here.
 */
export function buildAutotileWallTextures(renderer: Renderer, tileSize: number): Map<number, Texture> {
  const wallColor = TILE_PALETTE.find((entry) => entry.id === WALL_TILE_ID)!.color;
  const edgeThickness = Math.max(2, Math.round(tileSize * 0.12));
  const textures = new Map<number, Texture>();

  for (let bitmask = 0; bitmask < AUTOTILE_VARIANT_COUNT; bitmask++) {
    const graphics = new Graphics().rect(0, 0, tileSize, tileSize).fill(wallColor);
    if (!(bitmask & AUTOTILE_NORTH)) graphics.rect(0, 0, tileSize, edgeThickness).fill(WALL_AUTOTILE_EDGE_COLOR);
    if (!(bitmask & AUTOTILE_SOUTH)) graphics.rect(0, tileSize - edgeThickness, tileSize, edgeThickness).fill(WALL_AUTOTILE_EDGE_COLOR);
    if (!(bitmask & AUTOTILE_WEST)) graphics.rect(0, 0, edgeThickness, tileSize).fill(WALL_AUTOTILE_EDGE_COLOR);
    if (!(bitmask & AUTOTILE_EAST)) graphics.rect(tileSize - edgeThickness, 0, edgeThickness, tileSize).fill(WALL_AUTOTILE_EDGE_COLOR);
    textures.set(bitmask, renderer.generateTexture(graphics));
    graphics.destroy();
  }
  return textures;
}
