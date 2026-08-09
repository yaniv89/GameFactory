import type { ComponentFieldValues } from "../ecs/commandBuffer";
import type { EntityId } from "../ecs/entity";
import type { World } from "../ecs/world";

export interface SavedEntity {
  readonly id: EntityId;
  readonly components: Readonly<Record<string, Readonly<ComponentFieldValues>>>;
}

export interface SavedWorld {
  readonly entities: readonly SavedEntity[];
  readonly nextEntityId: number;
}

/**
 * Serializes every live entity's component data into the `world` shape of
 * `docs/SPEC.md` Section 8.5's `SaveFile`. Component names are written
 * verbatim, whatever they were registered under — SPEC 8.5's "namespaced
 * keys" note (e.g. `"@acme/weather:WindAffected"`) is a module-authoring
 * convention for avoiding cross-module name collisions, not something the
 * engine enforces structurally; core components (`Transform`, `Sprite`,
 * ...) are unnamespaced by design.
 */
export function serializeWorld(world: World): SavedWorld {
  const entities: SavedEntity[] = [];
  world.query([]).forEach((entity) => {
    const components: Record<string, ComponentFieldValues> = {};
    for (const name of world.componentsOf(entity)) {
      const value = world.get(entity, name);
      if (value) components[name] = value as ComponentFieldValues;
    }
    entities.push({ id: entity, components });
  });
  return { entities, nextEntityId: world.entityIndexBound };
}

/**
 * Restores every entity in `saved` into `world` at its exact original id,
 * via `World.restoreEntity`. `world` is expected to be freshly constructed
 * (components already `defineComponent`d, no entities yet) — this is a
 * load-time bulk operation, not a merge into a live world. Duplicate
 * entity ids in `saved.entities` are the caller's responsibility to reject
 * before calling this (see `packages/runtime-host/src/save/saveCoordinator.ts`,
 * which validates the whole `SaveFile` before touching the World) — this
 * function trusts its input and lets `EntityAllocator.restore()`'s own
 * "index is not free" throw catch what slips through.
 */
export function deserializeWorld(world: World, saved: SavedWorld): void {
  for (const entity of saved.entities) {
    world.restoreEntity(entity.id, entity.components);
  }
}
