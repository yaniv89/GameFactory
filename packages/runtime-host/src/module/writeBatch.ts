import type { EntityId, World } from "@forge/core";

/**
 * Negative integers the guest assigns to entities it creates during a
 * single `run()` call, before the host has applied the batch and allocated
 * a real `EntityId`. Never exposed as part of the public Module API
 * surface — `WorldApi.create()`'s return value is opaque to guest code
 * either way (`packages/module-api/src/entity.ts`: "Modules never
 * construct or decompose this value").
 */
export type GuestTempId = number;
export type GuestEntityRef = EntityId | GuestTempId;

function isTempId(id: GuestEntityRef): id is GuestTempId {
  return id < 0;
}

export interface QueuedCreate {
  readonly kind: "create";
  readonly tempId: GuestTempId;
  readonly components: Readonly<Record<string, Readonly<Record<string, number>>>>;
}
export interface QueuedDestroy {
  readonly kind: "destroy";
  readonly id: GuestEntityRef;
}
export interface QueuedAdd {
  readonly kind: "add";
  readonly id: GuestEntityRef;
  readonly component: string;
  readonly value: Readonly<Record<string, number>>;
}
export interface QueuedRemove {
  readonly kind: "remove";
  readonly id: GuestEntityRef;
  readonly component: string;
}
export interface QueuedSet {
  readonly kind: "set";
  readonly id: GuestEntityRef;
  readonly component: string;
  readonly value: Readonly<Record<string, number>>;
}

export type QueuedWrite = QueuedCreate | QueuedDestroy | QueuedAdd | QueuedRemove | QueuedSet;

function cloneComponentMap(
  components: Readonly<Record<string, Readonly<Record<string, number>>>>,
): Record<string, Record<string, number>> {
  const clone: Record<string, Record<string, number>> = {};
  for (const [name, fields] of Object.entries(components)) {
    clone[name] = { ...fields };
  }
  return clone;
}

type RealWrite =
  | { readonly kind: "createTemp"; readonly tempId: GuestTempId }
  | { readonly kind: "destroy"; readonly id: EntityId }
  | { readonly kind: "add"; readonly id: EntityId; readonly component: string; readonly value: Readonly<Record<string, number>> }
  | { readonly kind: "remove"; readonly id: EntityId; readonly component: string }
  | { readonly kind: "set"; readonly id: EntityId; readonly component: string; readonly value: Readonly<Record<string, number>> };

/**
 * Applies one system run's (or one interceptor call's) queued `WorldApi`
 * writes to the real World, per docs/adr/0005 step 4: one pass, in the
 * guest's own call order, after `run()` returns.
 *
 * Writes targeting a temp id (an entity the guest created earlier in the
 * *same* batch) are merged directly into that pending `create`'s initial
 * component values instead of being applied as a separate `world.set()` —
 * the entity isn't placed into an archetype until `world.create()` runs
 * (deferred, per `CommandBuffer`'s own doc comment), so a `set()` issued
 * before that would fail. This keeps the common `const e = world.create();
 * world.set(e, ...)` guest pattern working without an early, out-of-phase
 * `world.flush()` that would also flush other systems' pending structural
 * changes ahead of the phase boundary.
 *
 * v1 limitation, documented rather than worked around: a temp id created in
 * this batch cannot be read back with its real `EntityId` within the same
 * `run()` call — the real id only exists once this function actually calls
 * `world.create()`, which happens after `run()` has already returned.
 */
export function applyWriteBatch(world: World, writes: readonly QueuedWrite[]): void {
  const pendingCreateComponents = new Map<GuestTempId, Record<string, Record<string, number>>>();
  const destroyedTemp = new Set<GuestTempId>();
  const order: RealWrite[] = [];

  for (const write of writes) {
    if (write.kind === "create") {
      pendingCreateComponents.set(write.tempId, cloneComponentMap(write.components));
      order.push({ kind: "createTemp", tempId: write.tempId });
      continue;
    }
    if (isTempId(write.id)) {
      const components = pendingCreateComponents.get(write.id);
      if (!components) {
        throw new Error(
          `Module write batch: temp entity id ${write.id} referenced before it was created in this batch`,
        );
      }
      if (write.kind === "destroy") {
        destroyedTemp.add(write.id);
      } else if (write.kind === "remove") {
        delete components[write.component];
      } else {
        components[write.component] = { ...(components[write.component] ?? {}), ...write.value };
      }
      continue;
    }

    switch (write.kind) {
      case "destroy":
        order.push({ kind: "destroy", id: write.id });
        break;
      case "add":
        order.push({ kind: "add", id: write.id, component: write.component, value: write.value });
        break;
      case "remove":
        order.push({ kind: "remove", id: write.id, component: write.component });
        break;
      case "set":
        order.push({ kind: "set", id: write.id, component: write.component, value: write.value });
        break;
    }
  }

  for (const step of order) {
    switch (step.kind) {
      case "createTemp":
        if (!destroyedTemp.has(step.tempId)) {
          world.create(pendingCreateComponents.get(step.tempId));
        }
        break;
      case "destroy":
        world.destroy(step.id);
        break;
      case "add":
        world.add(step.id, step.component, step.value);
        break;
      case "remove":
        world.remove(step.id, step.component);
        break;
      case "set":
        world.set(step.id, step.component, step.value);
        break;
    }
  }
}
