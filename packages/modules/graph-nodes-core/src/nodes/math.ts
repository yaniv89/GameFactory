import type { GraphNodeDefinition } from "@forge/module-api";

/** All pure — no side effect, no flow socket, evaluated on demand. */

export const addNode: GraphNodeDefinition = {
  type: "core:add",
  inputs: [
    { name: "a", type: "number" },
    { name: "b", type: "number" },
  ],
  outputs: [{ name: "result", type: "number" }],
  execute(_ctx, inputs) {
    return { result: (inputs.a as number) + (inputs.b as number) };
  },
};

export const subtractNode: GraphNodeDefinition = {
  type: "core:subtract",
  inputs: [
    { name: "a", type: "number" },
    { name: "b", type: "number" },
  ],
  outputs: [{ name: "result", type: "number" }],
  execute(_ctx, inputs) {
    return { result: (inputs.a as number) - (inputs.b as number) };
  },
};

export const multiplyNode: GraphNodeDefinition = {
  type: "core:multiply",
  inputs: [
    { name: "a", type: "number" },
    { name: "b", type: "number" },
  ],
  outputs: [{ name: "result", type: "number" }],
  execute(_ctx, inputs) {
    return { result: (inputs.a as number) * (inputs.b as number) };
  },
};

/**
 * Divide-by-zero deliberately returns `0` rather than propagating `NaN`/
 * `Infinity` through the rest of the graph — for this audience (a
 * non-programmer wiring boxes together, docs/adr/0017's own framing), a
 * silently-wrong-but-finite number is more debuggable than a `NaN` that
 * poisons every downstream node it touches with no visible origin. Always
 * `ctx.warn()`s when it happens, so the failure is attributable rather
 * than silent (CLAUDE.md guardrail 11).
 */
export const divideNode: GraphNodeDefinition = {
  type: "core:divide",
  inputs: [
    { name: "a", type: "number" },
    { name: "b", type: "number" },
  ],
  outputs: [{ name: "result", type: "number" }],
  execute(ctx, inputs) {
    const a = inputs.a as number;
    const b = inputs.b as number;
    if (b === 0) {
      ctx.warn("core:divide received a divisor of 0 — returning 0 instead of NaN/Infinity", { a, b });
      return { result: 0 };
    }
    return { result: a / b };
  },
};
