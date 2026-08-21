import type { GraphNodeDefinition } from "../types";

/**
 * `core:onEvent` is a graph's entry point, not something invoked as part
 * of an ordinary flow chain — `@forge/graph-runtime` (M5) is what actually
 * calls `ctx.events.on(config.event, ...)` at setup and re-enters the
 * graph at this node with the received payload already placed into
 * `inputs.payload`. This node's own `execute()` only normalizes that
 * hand-off and continues the flow; it deliberately does not subscribe to
 * anything itself, matching docs/adr/0017 Decision 3's "M2's own node
 * definitions do their own genuinely-local part; the interpreter owns the
 * mechanism" split already used for the bounded-iteration nodes below.
 */
export const onEventNode: GraphNodeDefinition = {
  type: "core:onEvent",
  inputs: [{ name: "payload", type: "any" }],
  outputs: [
    { name: "flow", type: "flow" },
    { name: "payload", type: "any" },
  ],
  execute(ctx, inputs) {
    ctx.next("flow");
    return { payload: inputs.payload ?? null };
  },
};

export const emitEventNode: GraphNodeDefinition = {
  type: "core:emitEvent",
  inputs: [
    { name: "flow", type: "flow" },
    { name: "payload", type: "any" },
  ],
  outputs: [{ name: "flow", type: "flow" }],
  execute(ctx, inputs, config) {
    ctx.events.emit(config.event as string, inputs.payload);
    ctx.next("flow");
  },
};
