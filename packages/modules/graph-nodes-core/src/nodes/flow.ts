import type { GraphNodeDefinition } from "@forge/module-api";

export const branchNode: GraphNodeDefinition = {
  type: "core:branch",
  inputs: [
    { name: "flow", type: "flow" },
    { name: "condition", type: "boolean" },
  ],
  outputs: [
    { name: "true", type: "flow" },
    { name: "false", type: "flow" },
  ],
  execute(ctx, inputs) {
    ctx.next(inputs.condition ? "true" : "false");
  },
};

/**
 * docs/adr/0017 Decision 3: the only iteration constructs are structurally
 * bounded, never a runtime-variable/unbounded loop. This node's own job is
 * exactly the "genuinely-local part" the ADR's task split assigns to M2 —
 * clamp the requested count against a fixed ceiling and hand back the
 * clamped value as data. Walking the loop body that many times, once per
 * iteration with an index, is `@forge/graph-runtime`'s (M5's) interpreter
 * job: a single `execute()` call has no way to re-enter the graph N times
 * on its own, and this package doesn't pretend otherwise.
 */
export const DEFAULT_REPEAT_CEILING = 1000;
export const ABSOLUTE_REPEAT_CEILING = 10_000;

export const repeatNode: GraphNodeDefinition = {
  type: "core:repeat",
  inputs: [
    { name: "flow", type: "flow" },
    { name: "count", type: "number" },
  ],
  outputs: [
    { name: "flow", type: "flow" },
    { name: "count", type: "number" },
  ],
  execute(ctx, inputs, config) {
    const requested = Math.max(0, Math.trunc(Number(inputs.count) || 0));
    const configuredCeiling = Number(config.ceiling);
    const ceiling =
      Number.isFinite(configuredCeiling) && configuredCeiling > 0
        ? Math.min(configuredCeiling, ABSOLUTE_REPEAT_CEILING)
        : DEFAULT_REPEAT_CEILING;
    const clamped = Math.min(requested, ceiling);
    if (clamped !== requested) {
      ctx.warn(`core:repeat clamped a requested count of ${requested} down to ${clamped} (ceiling ${ceiling})`, {
        requested,
        clamped,
        ceiling,
      });
    }
    ctx.next("flow");
    return { count: clamped };
  },
};

/**
 * The other Decision 3 bounded construct: iteration is capped by the
 * query's own naturally-bounded result set (a world's entity count is
 * itself bounded), never by a runtime check that could be gotten wrong.
 * Same interpreter-owns-the-walk split as `core:repeat` above — this
 * node's own `execute()` only resolves the matched entity list once;
 * walking the loop body once per entity, with `entity` bound to the
 * current one, is `@forge/graph-runtime`'s (M5's) interpreter job
 * (`interpreter.ts`'s own `LoopBinding` mechanism) — a single `execute()`
 * call can't re-enter the graph N times on its own, and this node
 * doesn't pretend it does: `entity` is declared here as an output socket
 * so the editor can wire it, but this `execute()` never populates it
 * itself (the interpreter overwrites it per iteration, the same
 * "declared here, actually supplied by the interpreter" treatment
 * `core:onEvent`'s own `payload` input already gets, just on the output
 * side instead).
 *
 * The `entities` output is `"any"` rather than a dedicated array socket
 * type — deliberately: `GraphSocketType` (docs/adr/0017 Decision 4) is a
 * small, v1 set with no array/list type of its own, and inventing one
 * here would be exactly the kind of module-api surface decision this
 * package doesn't get to make unilaterally. It's a real, stated scope
 * trim, not a silently-guessed shape.
 */
export const forEachEntityNode: GraphNodeDefinition = {
  type: "core:forEachEntity",
  inputs: [{ name: "flow", type: "flow" }],
  outputs: [
    { name: "flow", type: "flow" },
    { name: "entity", type: "entity" },
    { name: "entities", type: "any" },
  ],
  execute(ctx, _inputs, config) {
    const components = Array.isArray(config.components) ? (config.components as string[]) : [];
    const view = ctx.world.query(components);
    const entities: unknown[] = [];
    view.forEach((entity) => entities.push(entity));
    ctx.next("flow");
    return { entities };
  },
};
