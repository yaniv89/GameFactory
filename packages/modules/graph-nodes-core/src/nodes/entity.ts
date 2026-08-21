import type { EntityId, GraphNodeDefinition } from "@forge/module-api";

/** Impure — creates an entity as a side effect, so it participates in flow order like any other action node. */
export const createEntityNode: GraphNodeDefinition = {
  type: "core:createEntity",
  inputs: [
    { name: "flow", type: "flow" },
    { name: "components", type: "any" },
  ],
  outputs: [
    { name: "flow", type: "flow" },
    { name: "entity", type: "entity" },
  ],
  execute(ctx, inputs) {
    const components = inputs.components as Record<string, unknown> | undefined;
    const entity = ctx.world.create(components);
    ctx.next("flow");
    return { entity };
  },
};

export const destroyEntityNode: GraphNodeDefinition = {
  type: "core:destroyEntity",
  inputs: [
    { name: "flow", type: "flow" },
    { name: "entity", type: "entity" },
  ],
  outputs: [{ name: "flow", type: "flow" }],
  execute(ctx, inputs) {
    ctx.world.destroy(inputs.entity as EntityId);
    ctx.next("flow");
  },
};
