import { FloatingTextSchema, TransformSchema, type EntityId, type Query, type SystemDefinition, type TickContext, type World } from "@forge/core";
import type { ContainerLike } from "./containerLike";
import { EntityDiffTracker } from "./entityDiff";

/** The subset of Pixi.Text (or a test fake) the sync system touches. */
export interface TextLike {
  position: { x: number; y: number };
  alpha: number;
  text: string;
  /** Same Y-depth-sort mechanism `SpriteLike.zIndex` uses (`spriteSync.ts`'s own doc comment) — a floating number should draw in front of whatever's behind it at its own height, not always on top or always behind. */
  zIndex?: number;
}

export type TextContainerLike<T extends TextLike> = ContainerLike<T>;

export interface TextSyncOptions<T extends TextLike> {
  world: World;
  container: ContainerLike<T>;
  /** Creates the display text object the first time an entity with `[Transform, FloatingText]` is seen. */
  createText(entity: EntityId): T;
}

/**
 * Bridges the ECS to a Pixi display tree for `FloatingText` entities
 * (H1d's damage numbers) — the text-object counterpart to
 * `createSpriteSyncSystem`, same create-on-first-seen / remove-on-gone
 * shape, but simpler: no interpolation snapshot (a floating number's own
 * drift, `createFloatingTextSystem`'s job, is smooth enough at 60Hz fixed
 * step without blending), and alpha is computed straight from
 * `age`/`ttl` here rather than copied from a component field, since
 * fading opacity *is* this system's whole visual contribution.
 */
export function createTextSyncSystem<T extends TextLike>(options: TextSyncOptions<T>): SystemDefinition {
  const { world, container, createText } = options;
  const textsByEntity = new Map<EntityId, T>();
  const tracker = new EntityDiffTracker();

  return {
    id: "@forge/render-2d:TextSync",
    phase: "PreRender",
    query: ["Transform", "FloatingText"],
    skipIfEmpty: false,
    run: (_ctx: TickContext, entities: Query) => {
      entities.forEach((entity) => {
        tracker.see(entity);

        let textObject = textsByEntity.get(entity);
        if (!textObject) {
          textObject = createText(entity);
          textsByEntity.set(entity, textObject);
          container.addChild(textObject);
        }

        const transform = world.get<typeof TransformSchema>(entity, "Transform");
        const floatingText = world.get<typeof FloatingTextSchema>(entity, "FloatingText");
        if (!transform || !floatingText) return;

        textObject.position.x = transform.x;
        textObject.position.y = transform.y;
        textObject.zIndex = transform.y;
        textObject.alpha = Math.max(0, 1 - floatingText.age / floatingText.ttl);
        textObject.text = `-${Math.round(floatingText.value)}`;
      });

      for (const entity of tracker.endFrame()) {
        const textObject = textsByEntity.get(entity);
        if (textObject) {
          container.removeChild(textObject);
          textsByEntity.delete(entity);
        }
      }
    },
  };
}
