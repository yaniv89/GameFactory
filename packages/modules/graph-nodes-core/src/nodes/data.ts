import type { GraphNodeDefinition } from "@forge/module-api";

/**
 * A genuine gap found while actually trying to build a mechanic with the
 * M2 node library (docs/adr/0017, M6): nothing in the original 20 node
 * types can hand a graph a literal value — no fixed "1" to add, no fixed
 * amount to heal by, no fixed string to compare a component field
 * against. Every other node's inputs are either wired from something
 * else or read a `config` value directly inside `execute()` (e.g.
 * `core:getComponent`'s `component` name) — but there was no *general*
 * way to feed a plain number/string/boolean into an ordinary data
 * socket. `core:constant` fills exactly that gap, additively: pure (no
 * flow socket, matching `core:add`'s own "all pure" grouping), config
 * holds the literal itself so the editor's inspector can offer a normal
 * value field for it.
 */
export const constantNode: GraphNodeDefinition = {
  type: "core:constant",
  inputs: [],
  outputs: [{ name: "value", type: "any" }],
  execute(_ctx, _inputs, config) {
    return { value: config.value };
  },
};

/**
 * The other gap found alongside `core:constant`: a trigger's `payload`
 * (`core:onEvent`) and a component's own value (`core:getComponent`) are
 * both `"any"`-typed compound objects in the common case (e.g.
 * `PickupCollectedEvent`'s `{player, itemId, amount, x, y}`) — with no
 * way to pull one named field back out, most real gameplay events simply
 * can't be reacted to usefully. `field` is a `config` value, the same
 * "picked once at authoring time, not wired at runtime" treatment
 * `core:getComponent`'s own `component` name already gets. Reading a
 * missing/undefined field returns `undefined` rather than throwing —
 * consistent with how every other pure node here degrades on a partially
 * wired graph (e.g. `core:getComponent` on a nonexistent component
 * returns `null`, never throws).
 */
export const getFieldNode: GraphNodeDefinition = {
  type: "core:getField",
  inputs: [{ name: "object", type: "any" }],
  outputs: [{ name: "value", type: "any" }],
  execute(_ctx, inputs, config) {
    const object = inputs.object;
    const field = config.field as string;
    if (typeof object !== "object" || object === null) return { value: undefined };
    return { value: (object as Record<string, unknown>)[field] };
  },
};

/**
 * A third gap, found while actually wiring a real mechanic end to end
 * (docs/adr/0017, M6): `core:setComponent`'s `value` input expects a
 * component-shaped object, and `core:getComponent`/`core:add` etc.
 * naturally produce a bare scalar (e.g. a healed HP number) — there was
 * no way to turn a bare number into an object with that number under the
 * right field name, without clobbering a component's other fields (a
 * `Health` component also carries `invulnerableUntil`/`flashUntil`;
 * overwriting the whole object with just `{current: n}` would be fine
 * here specifically only because `World.set`'s own merge semantics
 * already preserve untouched fields — the real problem `core:setField`
 * solves is producing that single-key `{current: n}` patch object in the
 * first place). `field` is a `config` value, the same authoring-time
 * treatment `core:getField`'s own `field` already gets.
 */
export const setFieldNode: GraphNodeDefinition = {
  type: "core:setField",
  inputs: [{ name: "value", type: "any" }],
  outputs: [{ name: "object", type: "any" }],
  execute(_ctx, inputs, config) {
    return { object: { [config.field as string]: inputs.value } };
  },
};
