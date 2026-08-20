import { SpriteSchema, TransformSchema, type EntityId, type Query, type SystemDefinition, type TickContext, type World } from "@forge/core";
import type { ContainerLike } from "./containerLike";
import { EntityDiffTracker } from "./entityDiff";
import { lerp, type TransformSnapshotStore } from "./interpolation";

/** The subset of Pixi.Sprite (or a test fake) the sync system touches. */
export interface SpriteLike {
  position: { x: number; y: number };
  scale: { x: number; y: number };
  anchor?: { x: number; y: number };
  rotation: number;
  tint: number;
  alpha: number;
  visible: boolean;
  texture?: unknown;
  /** Read by the container's `sortableChildren` render sort (`RenderHost`) — set from this entity's own interpolated world-space y every tick, the actual Y-depth-sort mechanism for a top-down scene. Optional so a fake in a test that doesn't care about draw order doesn't need to implement it. */
  zIndex?: number;
}

export type SpriteContainerLike<S extends SpriteLike> = ContainerLike<S>;

export interface SpriteSyncOptions<S extends SpriteLike> {
  world: World;
  container: ContainerLike<S>;
  snapshots: TransformSnapshotStore;
  /** Creates the display sprite the first time an entity with Transform+Sprite is seen. */
  createSprite(entity: EntityId): S;
  /** Resolves a Sprite component's (assetId, frame) to whatever `S.texture` expects. Return undefined to leave the sprite's current texture as-is (e.g. the asset is still loading). */
  resolveTexture?(assetId: number, frame: number): unknown;
}

/**
 * Bridges the ECS to a Pixi display tree, per docs/SPEC.md Section 8.3's
 * `PreRender` phase ("transform interpolation, camera, culling"):
 * - creates a sprite the first time an entity matching `[Transform,
 *   Sprite]` appears;
 * - every frame, blends position/rotation between the last fixed step's
 *   snapshot and the current Transform using `ctx.alpha`, and copies the
 *   Sprite component's visual fields (tint, opacity, anchor, texture);
 * - sets `zIndex` from the sprite's own interpolated y — the Y-depth sort
 *   for a top-down scene (`RenderHost`'s `sortableChildren` container is
 *   what actually applies it at draw time);
 * - removes the sprite once the entity stops matching (destroyed, or
 *   either component removed).
 */
export function createSpriteSyncSystem<S extends SpriteLike>(options: SpriteSyncOptions<S>): SystemDefinition {
  const { world, container, snapshots, createSprite, resolveTexture } = options;
  const spritesByEntity = new Map<EntityId, S>();
  const tracker = new EntityDiffTracker();

  return {
    id: "@forge/render-2d:SpriteSync",
    phase: "PreRender",
    query: ["Transform", "Sprite"],
    skipIfEmpty: false,
    run: (ctx: TickContext, entities: Query) => {
      entities.forEach((entity) => {
        tracker.see(entity);

        let sprite = spritesByEntity.get(entity);
        if (!sprite) {
          sprite = createSprite(entity);
          spritesByEntity.set(entity, sprite);
          container.addChild(sprite);
        }

        const transform = world.get<typeof TransformSchema>(entity, "Transform");
        if (transform) {
          const snapshot = snapshots.get(entity);
          const prevX = snapshot?.x ?? transform.x;
          const prevY = snapshot?.y ?? transform.y;
          const prevRotation = snapshot?.rotation ?? transform.rotation;
          sprite.position.x = lerp(prevX, transform.x, ctx.alpha);
          sprite.position.y = lerp(prevY, transform.y, ctx.alpha);
          sprite.rotation = lerp(prevRotation, transform.rotation, ctx.alpha);
          sprite.scale.x = transform.scaleX;
          sprite.scale.y = transform.scaleY;
          sprite.zIndex = sprite.position.y;
        }

        const spriteData = world.get<typeof SpriteSchema>(entity, "Sprite");
        if (spriteData) {
          sprite.tint = spriteData.tint;
          sprite.alpha = spriteData.opacity;
          if (sprite.anchor) {
            sprite.anchor.x = spriteData.anchorX;
            sprite.anchor.y = spriteData.anchorY;
          }
          const texture = resolveTexture?.(spriteData.assetId, spriteData.frame);
          if (texture !== undefined) sprite.texture = texture;
        }

        sprite.visible = true;
      });

      for (const entity of tracker.endFrame()) {
        const sprite = spritesByEntity.get(entity);
        if (sprite) {
          container.removeChild(sprite);
          spritesByEntity.delete(entity);
        }
      }
    },
  };
}
