import { TransformSchema, VelocitySchema, type EntityId, type SystemDefinition, type World } from "@forge/core";

/**
 * The same procedural-marker approach `packages/editor/src/canvas/entityMarkers.ts`
 * and its preview counterpart use — not a real asset pipeline (M6's Art
 * Pack system covers tiles, not character sprites yet; a stated gap, see
 * PackSwapDialog.tsx's own doc comment on this).
 */
export const PLAYER_ASSET_ID = 1;
export const NPC_ASSET_ID = 2;

export const MOVE_SPEED = 140; // world units/sec
/** How close the player must interact-press to trigger an NPC's dialogue. */
export const INTERACT_RANGE = 40;

export function spawnPlayer(world: World, worldX: number, worldY: number): EntityId {
  return world.create({
    Transform: { x: worldX, y: worldY, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    Velocity: { vx: 0, vy: 0, maxSpeed: MOVE_SPEED, friction: 0 },
    Collider: { shape: 1, width: 0, height: 0, offsetX: 0, offsetY: 0, isTrigger: 0, layer: 0 },
    PlayerControlled: { inputMapId: 0 },
    Sprite: { assetId: PLAYER_ASSET_ID, frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 },
  });
}

export function spawnNpcMarker(world: World, worldX: number, worldY: number): EntityId {
  return world.create({
    Transform: { x: worldX, y: worldY, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    Sprite: { assetId: NPC_ASSET_ID, frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 },
  });
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
      });
    },
  };
}
