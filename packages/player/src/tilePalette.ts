import { Graphics, type Renderer, type Texture } from "pixi.js";

/**
 * Matches `packages/editor/src/canvas/tilePalette.ts` exactly — flat
 * colors, not a real Art Pack render. There is no Art Pack asset bundling
 * in an exported build yet (a stated M6 gap, tracked for a later phase,
 * not silently skipped): an exported game currently renders the same
 * placeholder tile colors the editor's own canvas falls back to when no
 * pack is active. Duplicated rather than imported for the same reason
 * every other file this package shares a lineage with is: the player
 * package cannot depend on the editor app.
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

/** The one tile id gameplay treats as solid — must match the editor's own WALL_TILE_ID so an exported project's walls stay walls. */
export const WALL_TILE_ID = 4;

export function buildPaletteTextures(renderer: Renderer, tileSize: number): Map<number, Texture> {
  const textures = new Map<number, Texture>();
  for (const entry of TILE_PALETTE) {
    const graphics = new Graphics().rect(0, 0, tileSize, tileSize).fill(entry.color);
    textures.set(entry.id, renderer.generateTexture(graphics));
    graphics.destroy();
  }
  return textures;
}
