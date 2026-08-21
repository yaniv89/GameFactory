import type { EntityId, GraphNodeDefinition } from "@forge/module-api";

/**
 * The component name is a `config` value (the editor's per-node inspector,
 * a fixed dropdown of the project's known component names), not a data
 * socket — the same "picked once at authoring time, not wired at runtime"
 * treatment `@forge/dialogue`'s tree/node indices already get.
 */

/** Pure — a read never needs flow ordering against other reads. */
export const getComponentNode: GraphNodeDefinition = {
  type: "core:getComponent",
  inputs: [{ name: "entity", type: "entity" }],
  outputs: [{ name: "value", type: "any" }],
  execute(ctx, inputs, config) {
    const value = ctx.world.get(inputs.entity as EntityId, config.component as string);
    return { value: value ?? null };
  },
};

export const hasComponentNode: GraphNodeDefinition = {
  type: "core:hasComponent",
  inputs: [{ name: "entity", type: "entity" }],
  outputs: [{ name: "has", type: "boolean" }],
  execute(ctx, inputs, config) {
    return { has: ctx.world.has(inputs.entity as EntityId, config.component as string) };
  },
};

/** Impure — a write is a side effect, ordered like any other action node. */
export const setComponentNode: GraphNodeDefinition = {
  type: "core:setComponent",
  inputs: [
    { name: "flow", type: "flow" },
    { name: "entity", type: "entity" },
    { name: "value", type: "any" },
  ],
  outputs: [{ name: "flow", type: "flow" }],
  execute(ctx, inputs, config) {
    ctx.world.set(inputs.entity as EntityId, config.component as string, inputs.value as Record<string, unknown>);
    ctx.next("flow");
  },
};
