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
 * Snapshots a single live entity's component data — the per-entity unit
 * `serializeWorld` applies to every entity in the world. Exposed on its
 * own for callers that only ever need one entity's worth of save state
 * (e.g. the editor's live-preview persisting just the player's own
 * progress across a reload, not the whole session — see
 * `packages/editor/src/preview/devPreviewSave.ts`), where pulling in the
 * whole-world serializer would mean also deciding how to restore every
 * other live entity (NPCs, in-flight VFX, session fixtures) at its exact
 * original id, which that caller deliberately does not need to solve.
 */
export function serializeEntity(world: World, entity: EntityId): Readonly<Record<string, ComponentFieldValues>> {
  const components: Record<string, ComponentFieldValues> = {};
  for (const name of world.componentsOf(entity)) {
    const value = world.get(entity, name);
    if (value) components[name] = value as ComponentFieldValues;
  }
  return components;
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
    entities.push({ id: entity, components: serializeEntity(world, entity) });
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
