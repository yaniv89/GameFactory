import { TransformSchema, VelocitySchema, type EntityId, type SystemDefinition, type World } from "@forge/core";

/** `Sprite.assetId` values the preview's own procedural textures resolve by (entityMarkers.ts) — not a real asset pipeline (M6), a placeholder exactly like tilePalette.ts's tile ids. */
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

