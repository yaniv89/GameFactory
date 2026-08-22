import { Graphics, type Renderer, type Texture } from "pixi.js";
import { COIN_ASSET_ID, ENEMY_ASSET_ID, MOUNT_ASSET_ID, NPC_ASSET_ID, PLAYER_ASSET_ID, VFX_PARTICLE_ASSET_ID, WEAPON_ASSET_ID } from "./gameWorld.js";

/** Matches `packages/editor/src/canvas/entityMarkers.ts`'s colors — placeholder marker art, duplicated for the same "player cannot depend on editor" reason as everything else here. */
export const PLAYER_MARKER_COLOR = 0x5ec8f2; // cyan
export const NPC_MARKER_COLOR = 0xd162c9; // magenta
export const ENEMY_MARKER_COLOR = 0xd15c4a; // hostile red
export const COIN_MARKER_COLOR = 0xe0c14c; // gold
export const MOUNT_MARKER_COLOR = 0x8a5a3b; // saddle-brown
export const WEAPON_MARKER_COLOR = 0xb8c4cc; // steel-blue

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

  const coin = new Graphics().circle(center, center, radius * 0.6).fill(COIN_MARKER_COLOR);
  textures.set(COIN_ASSET_ID, renderer.generateTexture(coin));
  coin.destroy();

  // A triangle, not a circle — CLAUDE.md 5.6's "color is never the only
  // signal," matches the editor's own enemy marker shape exactly.
  const enemySize = radius * 1.9;
  const enemy = new Graphics()
    .poly([center, center - enemySize / 2, center - enemySize / 2, center + enemySize / 2, center + enemySize / 2, center + enemySize / 2])
    .fill(ENEMY_MARKER_COLOR);
  textures.set(ENEMY_ASSET_ID, renderer.generateTexture(enemy));
  enemy.destroy();

  const mountSize = radius * 2.1;
  const mount = new Graphics()
    .roundRect(center - mountSize / 2, center - mountSize / 2, mountSize, mountSize, mountSize * 0.3)
    .fill(MOUNT_MARKER_COLOR);
  textures.set(MOUNT_ASSET_ID, renderer.generateTexture(mount));
  mount.destroy();

  const bladeLength = tileSize * 0.8;
  const bladeWidth = tileSize * 0.16;
  const weapon = new Graphics().roundRect(-bladeLength / 2, -bladeWidth / 2, bladeLength, bladeWidth, bladeWidth * 0.4).fill(WEAPON_MARKER_COLOR);
  textures.set(WEAPON_ASSET_ID, renderer.generateTexture(weapon));
  weapon.destroy();

  // Baked white, not a final color: `spawnVfxBurst` tints each burst its
  // own way (impact spark vs. death burst) via `Sprite.tint`, matching
  // the editor's own `VFX_PARTICLE_TEXTURE_KEY` texture exactly.
  const vfxParticle = new Graphics().circle(0, 0, tileSize * 0.09).fill(0xffffff);
  textures.set(VFX_PARTICLE_ASSET_ID, renderer.generateTexture(vfxParticle));
  vfxParticle.destroy();

  return textures;
}
