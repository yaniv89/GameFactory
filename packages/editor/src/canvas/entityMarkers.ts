import { COIN_PICKUP_PREFAB, ENEMY_PREFAB, MOUNT_PREFAB, PLAYER_START_PREFAB, NPC_PREFAB } from "@forge/core";
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
/** K1: a placeable Enemy — a hostile red distinct from every other marker color, well clear of `--accent-running`'s amber (CLAUDE.md 5.1). */
export const ENEMY_MARKER_COLOR = 0xd15c4a;
/** H1e's dropped coin — gold, deliberately duller/more yellow than `--accent-running`'s amber so it never reads as "the running state" (CLAUDE.md 5.1). */
export const COIN_MARKER_COLOR = 0xe0c14c;
/** I1b's rideable mount — a saddle-brown distinct from every other marker/tile color and, per CLAUDE.md 5.1, well clear of `--accent-running`'s amber. */
export const MOUNT_MARKER_COLOR = 0x8a5a3b;
/** I1c's wielded-weapon visual — a cool steel-blue distinct from every other marker/tile color, well clear of `--accent-running`'s amber. */
export const WEAPON_MARKER_COLOR = 0xb8c4cc;
/** Texture map key for the wielded-weapon marker — not a `Prefab.id` (the weapon entity isn't a prefab; `createEquipmentSystem` creates/destroys it directly), so this is its own plain string constant instead. */
export const WEAPON_MARKER_TEXTURE_KEY = "weapon";
/**
 * Texture map key for I1d's VFX particle — baked *white*, unlike every
 * other marker here (which bake their own final color straight into the
 * texture): `spawnVfxBurst` gives every burst its own `Sprite.tint`
 * (impact sparks vs. a death burst want different colors from the exact
 * same texture), and a white base is what makes Pixi's multiplicative
 * tint reproduce that color exactly.
 */
export const VFX_PARTICLE_TEXTURE_KEY = "vfx-particle";

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

  // A triangle, not a circle — CLAUDE.md 5.6's "color is never the only
  // signal" (same reasoning the mount's own rounded square already
  // establishes), and reads as "hostile" at a glance the way an RTS/RPG
  // minimap marker convention already does.
  const enemySize = radius * 1.9;
  const enemy = new Graphics()
    .poly([center, center - enemySize / 2, center - enemySize / 2, center + enemySize / 2, center + enemySize / 2, center + enemySize / 2])
    .fill(ENEMY_MARKER_COLOR);
  textures.set(ENEMY_PREFAB.id, renderer.generateTexture(enemy));
  enemy.destroy();

  // A rounded rectangle, not another circle — CLAUDE.md 5.6's "color is
  // never the only signal" applies to game-world markers too, not just
  // editor chrome, and every other marker here is a circle.
  const mountSize = radius * 2.1;
  const mount = new Graphics()
    .roundRect(center - mountSize / 2, center - mountSize / 2, mountSize, mountSize, mountSize * 0.3)
    .fill(MOUNT_MARKER_COLOR);
  textures.set(MOUNT_PREFAB.id, renderer.generateTexture(mount));
  mount.destroy();

  // A thin elongated blade, not a circle or a square — its own shape
  // reads as "held object" and makes createEquipmentSystem's own
  // per-tick rotation (pointing along the wearer's facing) visible at a
  // glance, the same "shape carries meaning too" reasoning the mount's
  // own rounded square already establishes. Drawn symmetric around the
  // local origin so `renderer.generateTexture`'s own bounding-box trim
  // keeps the sprite's anchor(0.5, 0.5) centered on the shape, the same
  // as every other marker here.
  const bladeLength = tileSize * 0.8;
  const bladeWidth = tileSize * 0.16;
  const weapon = new Graphics().roundRect(-bladeLength / 2, -bladeWidth / 2, bladeLength, bladeWidth, bladeWidth * 0.4).fill(WEAPON_MARKER_COLOR);
  const weaponTexture = renderer.generateTexture(weapon);
  weapon.destroy();
  textures.set(WEAPON_MARKER_TEXTURE_KEY, weaponTexture);

  const vfxParticle = new Graphics().circle(0, 0, tileSize * 0.09).fill(0xffffff);
  const vfxParticleTexture = renderer.generateTexture(vfxParticle);
  vfxParticle.destroy();
  textures.set(VFX_PARTICLE_TEXTURE_KEY, vfxParticleTexture);

  return textures;
}
