import {
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
 * `Sprite.assetId` values the preview's own procedural textures resolve by
 * (entityMarkers.ts) — not a real asset pipeline yet (L1–L5, tasks
 * #134–#138), a placeholder exactly like tilePalette.ts's tile ids. Keyed
 * by `Prefab.spriteAssetKey`, matching `packages/player/src/gameWorld.ts`'s
 * own copy of this table (duplicated for the same "player cannot depend
 * on the editor" reason as everything else in this file).
 */
export const PLAYER_ASSET_ID = 1;
export const NPC_ASSET_ID = 2;

const SPRITE_ASSET_IDS: Readonly<Record<string, number>> = {
  player: PLAYER_ASSET_ID,
  npc: NPC_ASSET_ID,
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

/** Currently-held movement keys, WASD and arrows both accepted. Owned by PreviewApp's keydown/keyup listeners; read here each tick. */
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
 * Integrates player movement against tile-grid collision. Not core's
 * generic entity-vs-entity AABB system (`createCollisionSystem`, M1
 * Phase 4) — that's the wrong tool for "don't walk into a wall tile": it
 * would mean spawning a static Collider entity per solid tile (hundreds,
 * for a two-room map) just to reuse a broad-phase spatial hash built for
 * moving entities. A direct tile lookup against the live TilemapLayer
 * (`isWalkable`, closed over by the caller) is the simpler, correct tool
 * for grid-based collision, and reuses the exact same tile data already
 * driving what's on screen — no second source of truth to keep in sync.
 */
export function createPlayerMovementSystem(world: World, isWalkable: (worldX: number, worldY: number) => boolean, keysHeld: HeldKeys): SystemDefinition {
  return {
    id: "preview:playerMovement",
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
        // Axis-independent so the player slides along a wall instead of
        // fully stopping when only one axis is blocked.
        if (dx !== 0 && isWalkable(transform.x + dx, transform.y)) nextX = transform.x + dx;
        if (dy !== 0 && isWalkable(nextX, transform.y + dy)) nextY = transform.y + dy;

        if (nextX !== transform.x || nextY !== transform.y) {
          world.set(entity, "Transform", { x: nextX, y: nextY });
        }
      });
    },
  };
}

