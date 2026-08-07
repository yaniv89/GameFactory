import { Graphics, type Renderer, type Texture } from "pixi.js";
import type { EntityPlacement } from "../store/projectStore";

/**
 * Placeholder marker art for entities placed on the grid — same "flat
 * colors, not tokens.css" reasoning as tilePalette.ts. Colors are chosen
 * to read clearly against all four tile colors and to stay well clear of
 * `--accent-running` (CLAUDE.md 5.1 reserves amber for the running state
 * in *editor chrome*; these are game-world content markers, the same
 * category tile colors already are, but picked distinctly anyway to
 * avoid any ambiguity).
 */
export const PLAYER_MARKER_COLOR = 0x5ec8f2; // cyan
export const NPC_MARKER_COLOR = 0xd162c9; // magenta

export function buildEntityTextures(renderer: Renderer, tileSize: number): Map<EntityPlacement["kind"], Texture> {
  const radius = tileSize * 0.35;
  const center = tileSize / 2;
  const textures = new Map<EntityPlacement["kind"], Texture>();

  const player = new Graphics().circle(center, center, radius).fill(PLAYER_MARKER_COLOR);
  textures.set("player-start", renderer.generateTexture(player));
  player.destroy();

  const npc = new Graphics().circle(center, center, radius).fill(NPC_MARKER_COLOR);
  textures.set("npc", renderer.generateTexture(npc));
  npc.destroy();

  return textures;
}
