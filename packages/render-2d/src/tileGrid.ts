/** A tile id of 0 means "no tile" — nothing is drawn for that cell. Matches the Tiled/GID convention used elsewhere in the tooling. */
export const EMPTY_TILE_ID = 0;

export interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function tileIndex(x: number, y: number, gridWidth: number): number {
  return y * gridWidth + x;
}

export function tileCoordsFromIndex(index: number, gridWidth: number): { x: number; y: number } {
  return { x: index % gridWidth, y: Math.floor(index / gridWidth) };
}

/**
 * Maps a 1-based tile id to its source rectangle in a grid-packed tileset
 * atlas (row-major, `tilesetColumns` tiles wide). Tile id 0 has no frame.
 */
export function tileFrameRect(tileId: number, tilesetColumns: number, tileSize: number): TileRect | undefined {
  if (tileId === EMPTY_TILE_ID || tilesetColumns <= 0) return undefined;
  const zeroBased = tileId - 1;
  const column = zeroBased % tilesetColumns;
  const row = Math.floor(zeroBased / tilesetColumns);
  return { x: column * tileSize, y: row * tileSize, width: tileSize, height: tileSize };
}

/** World-space bounds of the grid cells intersecting `bounds`, clamped to the grid's own extent. */
export function tileRangeInBounds(
  bounds: { left: number; top: number; right: number; bottom: number },
  gridWidth: number,
  gridHeight: number,
  tileSize: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const minX = Math.max(0, Math.floor(bounds.left / tileSize));
  const minY = Math.max(0, Math.floor(bounds.top / tileSize));
  const maxX = Math.min(gridWidth - 1, Math.floor(bounds.right / tileSize));
  const maxY = Math.min(gridHeight - 1, Math.floor(bounds.bottom / tileSize));
  return { minX, minY, maxX, maxY };
}
