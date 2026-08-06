import type { EntityId } from "./entity";
import type { SaveFile } from "./save";
import type { WorldApi } from "./world";

/**
 * The core-curated interception points, per docs/SPEC.md Section 9.4 —
 * the WordPress-"filter" mechanism a Module uses to transform a value in
 * a priority-ordered chain without patching the value's producer.
 *
 * ⚠ v1 limitation, stated plainly rather than silently: this is a fixed,
 * closed set. A module can hook into any of these points, but cannot
 * yet *publish* a brand-new point of its own for other modules to hook
 * into — `docs/SPEC.md`'s own weather/movement example only shows a
 * module hooking an existing core point. If real usage shows modules
 * need to define their own interception points, that's a new,
 * additive mechanism to design then (e.g. declaration-merging this
 * type), not something this version pretends to already support.
 */
export type InterceptorMap = {
  "combat:damage": { attacker: EntityId; target: EntityId; amount: number; type: string };
  "combat:hitChance": { attacker: EntityId; target: EntityId; chance: number };
  "dialogue:line": { speaker: string; text: string; locale: string };
  "dialogue:choices": { choices: readonly DialogueChoice[] };
  "inventory:canAddItem": { entity: EntityId; itemId: string; qty: number; allowed: boolean };
  "inventory:itemPrice": { itemId: string; basePrice: number; vendor: EntityId };
  "movement:speed": { entity: EntityId; speed: number };
  "render:tileTint": { tileX: number; tileY: number; layer: string; tint: number };
  "save:beforeWrite": { data: SaveFile };
  "save:afterRead": { data: SaveFile };
  "scene:beforeLoad": { sceneId: string; cancel: boolean };
};

export interface DialogueChoice {
  readonly id: string;
  readonly text: string;
}

export interface InterceptorContext {
  readonly world: WorldApi;
}

export type InterceptorFn<K extends keyof InterceptorMap> = (
  value: InterceptorMap[K],
  ctx: InterceptorContext,
) => InterceptorMap[K];
