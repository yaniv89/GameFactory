import {
  COIN_PICKUP_PREFAB,
  ENEMY_PREFAB,
  MOUNT_PREFAB,
  NPC_PREFAB,
  PLAYER_START_PREFAB,
  TransformSchema,
  VelocitySchema,
  spawnFromPrefab,
  type EntityId,
  type SystemDefinition,
  type World,
} from "@forge/core";

/**
 * The same procedural-marker approach `packages/editor/src/canvas/entityMarkers.ts`
 * and its preview counterpart use — not a real asset pipeline yet (L1–L5,
 * tasks #134–#138, land the Art Pack manifest categories and ingestion
 * pipeline this eventually resolves through instead). Keyed by
 * `Prefab.spriteAssetKey`, not the old numeric-constant-per-kind scheme —
 * this is the resolution table `spawnFromPrefab`'s `resolveSpriteAssetId`
 * callback reads. Matches `packages/editor/src/preview/gameWorld.ts`'s own
 * numbering exactly, though nothing requires that beyond readability —
 * this package resolves its own ids independently.
 */
export const PLAYER_ASSET_ID = 1;
export const NPC_ASSET_ID = 2;
export const ENEMY_ASSET_ID = 3;
export const COIN_ASSET_ID = 4;
export const MOUNT_ASSET_ID = 5;
/** I1c's wielded-weapon visual — not resolved through `SPRITE_ASSET_IDS`/`spawnFromPrefab`: the weapon entity isn't a prefab (`createEquipmentSystem` creates/destroys it directly), so this is just the plain numeric `Sprite.assetId` handed to that system's own `weaponAssetId` option. */
export const WEAPON_ASSET_ID = 6;
/** I1d's VFX particle visual — same "not a prefab, plain pre-resolved constant" reasoning as `WEAPON_ASSET_ID`. */
export const VFX_PARTICLE_ASSET_ID = 7;

const SPRITE_ASSET_IDS: Readonly<Record<string, number>> = {
  player: PLAYER_ASSET_ID,
  npc: NPC_ASSET_ID,
  enemy: ENEMY_ASSET_ID,
  coin: COIN_ASSET_ID,
  mount: MOUNT_ASSET_ID,
};

function resolveSpriteAssetId(spriteAssetKey: string): number {
  return SPRITE_ASSET_IDS[spriteAssetKey] ?? -1;
}

/** How close the player must interact-press to trigger an NPC's dialogue. */
export const INTERACT_RANGE = 40;

export function spawnPlayer(world: World, worldX: number, worldY: number): EntityId {
  return spawnFromPrefab(world, PLAYER_START_PREFAB, worldX, worldY, resolveSpriteAssetId);
}

export function spawnNpcMarker(world: World, worldX: number, worldY: number): EntityId {
  return spawnFromPrefab(world, NPC_PREFAB, worldX, worldY, resolveSpriteAssetId);
}

export function spawnEnemy(world: World, worldX: number, worldY: number): EntityId {
  return spawnFromPrefab(world, ENEMY_PREFAB, worldX, worldY, resolveSpriteAssetId);
}

/** Spawned at a killed enemy's own last position (`combat:death`'s payload, in `gameLogic.ts`), not scene-authored — same shape `spawnEnemy`/`spawnMount` already are for content that isn't a scene placement. */
export function spawnCoinPickup(world: World, worldX: number, worldY: number): EntityId {
  return spawnFromPrefab(world, COIN_PICKUP_PREFAB, worldX, worldY, resolveSpriteAssetId);
}

export function spawnMount(world: World, worldX: number, worldY: number): EntityId {
  return spawnFromPrefab(world, MOUNT_PREFAB, worldX, worldY, resolveSpriteAssetId);
}

/** Currently-held movement keys, WASD and arrows both accepted. */
export type HeldKeys = ReadonlySet<string>;

function movementAxis(keys: HeldKeys): { x: number; y: number } {
  let x = 0;
  let y = 0;
  if (keys.has("ArrowUp") || keys.has("w") || keys.has("W")) y -= 1;
  if (keys.has("ArrowDown") || keys.has("s") || keys.has("S")) y += 1;
  if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) x -= 1;
  if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) x += 1;
  const length = Math.hypot(x, y);
  return length > 0 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
}

/**
 * Integrates player movement against tile-grid collision via a direct
 * tile lookup (`isWalkable`, closed over by the caller) rather than
 * core's generic entity-vs-entity AABB system — the same choice and
 * reasoning `packages/editor/src/preview/gameWorld.ts`'s own doc comment
 * gives (that file's the origin of this one; duplicated rather than
 * imported since the player package cannot depend on the editor app, and
 * this is small and self-contained enough that the duplication is cheap
 * to keep in sync by inspection, not a shared abstraction worth forcing).
 */
export function createPlayerMovementSystem(world: World, isWalkable: (worldX: number, worldY: number) => boolean, keysHeld: HeldKeys): SystemDefinition {
  return {
    id: "player:playerMovement",
    phase: "Update",
    query: ["Transform", "Velocity", "PlayerControlled"],
    run: (ctx, entities) => {
      const axis = movementAxis(keysHeld);
      entities.forEach((entity) => {
        const transform = world.get<typeof TransformSchema>(entity, "Transform");
        const velocity = world.get<typeof VelocitySchema>(entity, "Velocity");
        if (!transform || !velocity) return;

        const dx = axis.x * velocity.maxSpeed * ctx.dt;
        const dy = axis.y * velocity.maxSpeed * ctx.dt;
        let nextX = transform.x;
        let nextY = transform.y;
        if (dx !== 0 && isWalkable(transform.x + dx, transform.y)) nextX = transform.x + dx;
        if (dy !== 0 && isWalkable(nextX, transform.y + dy)) nextY = transform.y + dy;

        if (nextX !== transform.x || nextY !== transform.y) {
          world.set(entity, "Transform", { x: nextX, y: nextY });
        }
        // The *actual* applied displacement, not the raw input axis — a
        // move a wall blocked reports zero velocity on that axis, which is
        // what `createCharacterAnimationSystem` needs to stop the walk
        // cycle exactly when the player visibly stops, not merely when
        // they release the key.
        world.set(entity, "Velocity", { vx: ctx.dt > 0 ? (nextX - transform.x) / ctx.dt : 0, vy: ctx.dt > 0 ? (nextY - transform.y) / ctx.dt : 0 });
      });
    },
  };
}
