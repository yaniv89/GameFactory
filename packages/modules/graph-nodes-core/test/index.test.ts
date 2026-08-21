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

  it("registers exactly the v1 node list docs/adr/0017's task split names for M2", () => {
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
      ]),
    );
  });
});
