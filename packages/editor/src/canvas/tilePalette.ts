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
