import { describe, expect, it } from "vitest";
import { coreGraphNodes } from "../src/index";

describe("coreGraphNodes", () => {
  it("has a unique, namespaced type for every node", () => {
    const types = coreGraphNodes.map((node) => node.type);
    expect(new Set(types).size).toBe(types.length);
    for (const type of types) expect(type).toMatch(/^core:[a-zA-Z]+$/);
  });

  it("gives every impure node (one with a flow socket) at least one flow output", () => {
    // Every impure node must be able to tell the interpreter where to
    // continue. A flow *input* is not required on every impure node —
    // "core:onEvent" is a graph entry point invoked directly by the
    // interpreter, so it has no flow input by design (see its own doc
    // comment in src/nodes/events.ts).
    for (const node of coreGraphNodes) {
      const hasFlowSocket = [...node.inputs, ...node.outputs].some((socket) => socket.type === "flow");
      if (!hasFlowSocket) continue;
      expect(node.outputs.some((socket) => socket.type === "flow"), `${node.type} should have a flow output`).toBe(true);
    }
  });

  it("registers exactly the v1 node list — docs/adr/0017's own M2 task-split names, plus core:constant/core:getField/core:setField (found missing while actually building a mechanic at M6), plus the four docs/adr/0018 quest nodes (M7), plus the two docs/adr/0018 data-table nodes (M11)", () => {
    const types = new Set(coreGraphNodes.map((node) => node.type));
    expect(types).toEqual(
      new Set([
        "core:createEntity",
        "core:destroyEntity",
        "core:getComponent",
        "core:hasComponent",
        "core:setComponent",
        "core:onEvent",
        "core:emitEvent",
        "core:equals",
        "core:greaterThan",
        "core:lessThan",
        "core:and",
        "core:or",
        "core:not",
        "core:add",
        "core:subtract",
        "core:multiply",
        "core:divide",
        "core:branch",
        "core:repeat",
        "core:forEachEntity",
        "core:constant",
        "core:getField",
        "core:setField",
        "core:questStart",
        "core:questCompleteObjective",
        "core:questIsActive",
        "core:questIsObjectiveComplete",
        "core:lookupRow",
        "core:tableRowCount",
      ]),
    );
  });
});
