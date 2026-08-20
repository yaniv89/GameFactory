import { tileIndex } from "./tileGrid";

/**
 * H1g's 4-bit ("blob"/Wang-tile-adjacent) autotile bitmask — the standard
 * genre convention for a same-type tile that needs to visually distinguish
 * an interior cell (surrounded on all four sides by the same tile type)
 * from an edge or a corner. Each bit is set when the corresponding
 * cardinal neighbor is also a match; a map edge (no neighbor there at
 * all) counts as "not matching," the same as an actually-different tile —
 * both cases mean that side is visually exposed, which is what an
 * autotile texture needs to show either way.
 */
export const AUTOTILE_NORTH = 1;
export const AUTOTILE_EAST = 2;
export const AUTOTILE_SOUTH = 4;
export const AUTOTILE_WEST = 8;

/** Every possible 4-neighbor bitmask value, 0 (fully exposed / isolated) through 15 (fully enclosed) — the exact variant count a caller generating autotile textures needs to produce. */
export const AUTOTILE_VARIANT_COUNT = 16;

/**
 * Computes cell `(x, y)`'s own 4-neighbor autotile bitmask against a flat,
 * row-major `tiles` grid: which of its N/E/S/W neighbors also equal
 * `matchId`. Pure and allocation-free — safe to call once per cell on
 * every repaint without contributing to steady-state GC pressure
 * (CLAUDE.md Section 1.3, guardrail 14), the same discipline
 * `computeColliderAABB` already holds itself to.
 */
export function computeAutotileBitmask(
  tiles: ArrayLike<number>,
  x: number,
  y: number,
  gridWidth: number,
  gridHeight: number,
  matchId: number,
): number {
  let bitmask = 0;
  if (y > 0 && tiles[tileIndex(x, y - 1, gridWidth)] === matchId) bitmask |= AUTOTILE_NORTH;
  if (x < gridWidth - 1 && tiles[tileIndex(x + 1, y, gridWidth)] === matchId) bitmask |= AUTOTILE_EAST;
  if (y < gridHeight - 1 && tiles[tileIndex(x, y + 1, gridWidth)] === matchId) bitmask |= AUTOTILE_SOUTH;
  if (x > 0 && tiles[tileIndex(x - 1, y, gridWidth)] === matchId) bitmask |= AUTOTILE_WEST;
  return bitmask;
}
