import { COIN_PICKUP_PREFAB, PLAYER_START_PREFAB, NPC_PREFAB } from "@forge/core";
import { Graphics, type Renderer, type Texture } from "pixi.js";

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
/** H1e's dropped coin — gold, deliberately duller/more yellow than `--accent-running`'s amber so it never reads as "the running state" (CLAUDE.md 5.1). */
export const COIN_MARKER_COLOR = 0xe0c14c;

/** Keyed by `EntityPlacement.prefabId` — not a closed union, per docs/adr/0015-entity-prefab-component-model.md. */
export function buildEntityTextures(renderer: Renderer, tileSize: number): Map<string, Texture> {
  const radius = tileSize * 0.35;
  const center = tileSize / 2;
  const textures = new Map<string, Texture>();

  const player = new Graphics().circle(center, center, radius).fill(PLAYER_MARKER_COLOR);
  textures.set(PLAYER_START_PREFAB.id, renderer.generateTexture(player));
  player.destroy();

  const npc = new Graphics().circle(center, center, radius).fill(NPC_MARKER_COLOR);
  textures.set(NPC_PREFAB.id, renderer.generateTexture(npc));
  npc.destroy();

  const coin = new Graphics().circle(center, center, radius * 0.6).fill(COIN_MARKER_COLOR);
  textures.set(COIN_PICKUP_PREFAB.id, renderer.generateTexture(coin));
  coin.destroy();

  return textures;
}
