import { Graphics, type Renderer, type Texture } from "pixi.js";
import { NPC_ASSET_ID, PLAYER_ASSET_ID } from "./gameWorld.js";

/** Matches `packages/editor/src/canvas/entityMarkers.ts`'s colors — placeholder marker art, duplicated for the same "player cannot depend on editor" reason as everything else here. */
export const PLAYER_MARKER_COLOR = 0x5ec8f2; // cyan
export const NPC_MARKER_COLOR = 0xd162c9; // magenta

export function buildEntityTextures(renderer: Renderer, tileSize: number): Map<number, Texture> {
  const radius = tileSize * 0.35;
  const center = tileSize / 2;
  const textures = new Map<number, Texture>();

  const player = new Graphics().circle(center, center, radius).fill(PLAYER_MARKER_COLOR);
  textures.set(PLAYER_ASSET_ID, renderer.generateTexture(player));
  player.destroy();

  const npc = new Graphics().circle(center, center, radius).fill(NPC_MARKER_COLOR);
  textures.set(NPC_ASSET_ID, renderer.generateTexture(npc));
  npc.destroy();

  return textures;
}
