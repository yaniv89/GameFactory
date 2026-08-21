import type { GraphNodeDefinition } from "@forge/module-api";

/** All pure — no side effect, no flow socket, evaluated on demand. */

export const equalsNode: GraphNodeDefinition = {
  type: "core:equals",
  inputs: [
    { name: "a", type: "any" },
    { name: "b", type: "any" },
  ],
  outputs: [{ name: "result", type: "boolean" }],
  execute(_ctx, inputs) {
    return { result: inputs.a === inputs.b };
  },
};

export const greaterThanNode: GraphNodeDefinition = {
  type: "core:greaterThan",
  inputs: [
    { name: "a", type: "number" },
    { name: "b", type: "number" },
  ],
  outputs: [{ name: "result", type: "boolean" }],
  execute(_ctx, inputs) {
    return { result: (inputs.a as number) > (inputs.b as number) };
  },
};

export const lessThanNode: GraphNodeDefinition = {
  type: "core:lessThan",
  inputs: [
    { name: "a", type: "number" },
    { name: "b", type: "number" },
  ],
  outputs: [{ name: "result", type: "boolean" }],
  execute(_ctx, inputs) {
    return { result: (inputs.a as number) < (inputs.b as number) };
  },
};

export const andNode: GraphNodeDefinition = {
  type: "core:and",
  inputs: [
    { name: "a", type: "boolean" },
    { name: "b", type: "boolean" },
  ],
  outputs: [{ name: "result", type: "boolean" }],
  execute(_ctx, inputs) {
    return { result: Boolean(inputs.a) && Boolean(inputs.b) };
  },
};

export const orNode: GraphNodeDefinition = {
  type: "core:or",
  inputs: [
    { name: "a", type: "boolean" },
    { name: "b", type: "boolean" },
  ],
  outputs: [{ name: "result", type: "boolean" }],
  execute(_ctx, inputs) {
    return { result: Boolean(inputs.a) || Boolean(inputs.b) };
  },
};

export const notNode: GraphNodeDefinition = {
  type: "core:not",
  inputs: [{ name: "a", type: "boolean" }],
  outputs: [{ name: "result", type: "boolean" }],
  execute(_ctx, inputs) {
    return { result: !inputs.a };
  },
};
