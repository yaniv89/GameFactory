import { coreGraphNodes } from "@forge/graph-nodes-core";
import type { GraphNodeDefinition } from "@forge/module-api";
import { describe, expect, it } from "vitest";
import { compileGraph } from "../src/compileGraph";
import type { GraphDocumentData } from "../src/types";

const nodeTypes = new Map<string, GraphNodeDefinition>(coreGraphNodes.map((n) => [n.type, n]));

function makeWarn() {
  const messages: string[] = [];
  return { warn: (m: string) => messages.push(m), messages };
}

const BASE: GraphDocumentData = { id: "g1", name: "test graph", nodes: [], edges: [] };

describe("compileGraph (docs/adr/0017 Decision 5 — re-validates from scratch, never trusts the editor)", () => {
  it("compiles a valid trigger -> action chain and identifies the trigger node", () => {
    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "trigger", type: "core:onEvent", config: { event: "damage:dealt" } },
        { id: "destroy", type: "core:destroyEntity", config: {} },
      ],
      edges: [{ id: "e1", source: "trigger", target: "destroy", sourceHandle: "flow", targetHandle: "flow" }],
    };
    const { warn } = makeWarn();
    const graph = compileGraph(doc, nodeTypes, warn);
    expect(graph).toBeDefined();
    expect(graph!.triggerNodeIds).toEqual(["trigger"]);
    expect(graph!.nodes.size).toBe(2);
    expect(graph!.outgoingFlow.get("trigger:flow")?.target).toBe("destroy");
  });

  it("rejects a duplicate node id", () => {
    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "a", type: "core:onEvent", config: {} },
        { id: "a", type: "core:onEvent", config: {} },
      ],
      edges: [],
    };
    const { warn, messages } = makeWarn();
    expect(compileGraph(doc, nodeTypes, warn)).toBeUndefined();
    expect(messages[0]).toContain("duplicate node id");
  });

  it("rejects a node referencing an unknown node type", () => {
    const doc: GraphDocumentData = { ...BASE, nodes: [{ id: "a", type: "acme:doesNotExist", config: {} }], edges: [] };
    const { warn, messages } = makeWarn();
    expect(compileGraph(doc, nodeTypes, warn)).toBeUndefined();
    expect(messages[0]).toContain("unknown node type");
  });

  it("rejects an edge referencing an unknown source or target node", () => {
    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [{ id: "a", type: "core:onEvent", config: {} }],
      edges: [{ id: "e1", source: "a", target: "ghost", sourceHandle: "flow", targetHandle: "flow" }],
    };
    const { warn, messages } = makeWarn();
    expect(compileGraph(doc, nodeTypes, warn)).toBeUndefined();
    expect(messages[0]).toContain("unknown target node");
  });

  it("rejects an edge referencing a socket that doesn't exist on the node type", () => {
    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "a", type: "core:onEvent", config: {} },
        { id: "b", type: "core:destroyEntity", config: {} },
      ],
      edges: [{ id: "e1", source: "a", target: "b", sourceHandle: "notARealSocket", targetHandle: "flow" }],
    };
    const { warn, messages } = makeWarn();
    expect(compileGraph(doc, nodeTypes, warn)).toBeUndefined();
    expect(messages[0]).toContain("no output socket");
  });

  it("rejects a socket-type mismatch (flow -> data)", () => {
    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "a", type: "core:onEvent", config: {} },
        { id: "b", type: "core:destroyEntity", config: {} },
      ],
      edges: [{ id: "e1", source: "a", target: "b", sourceHandle: "flow", targetHandle: "entity" }],
    };
    const { warn, messages } = makeWarn();
    expect(compileGraph(doc, nodeTypes, warn)).toBeUndefined();
    expect(messages[0]).toContain("socket types don't match");
  });

  it("accepts an 'any'-typed output wired into a concrete-typed input", () => {
    // core:getComponent's "value" output is "any"; core:hasComponent's
    // "entity" input is the concrete "entity" type — any/concrete pairing
    // must compile, per socketsCompatible's own rule.
    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "get", type: "core:getComponent", config: {} },
        { id: "has", type: "core:hasComponent", config: {} },
      ],
      edges: [{ id: "e1", source: "get", target: "has", sourceHandle: "value", targetHandle: "entity" }],
    };
    const { warn, messages } = makeWarn();
    expect(compileGraph(doc, nodeTypes, warn)).toBeDefined();
    expect(messages).toEqual([]);
  });

  it("rejects a flow output with more than one outgoing edge (fan-out > 1)", () => {
    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "trigger", type: "core:onEvent", config: {} },
        { id: "b1", type: "core:destroyEntity", config: {} },
        { id: "b2", type: "core:destroyEntity", config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "b1", sourceHandle: "flow", targetHandle: "flow" },
        { id: "e2", source: "trigger", target: "b2", sourceHandle: "flow", targetHandle: "flow" },
      ],
    };
    const { warn, messages } = makeWarn();
    expect(compileGraph(doc, nodeTypes, warn)).toBeUndefined();
    expect(messages[0]).toContain("already has an outgoing edge");
  });

  it("rejects a data input with more than one incoming edge (fan-in > 1)", () => {
    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "e1n", type: "core:onEvent", config: {} },
        { id: "e2n", type: "core:onEvent", config: {} },
        { id: "get", type: "core:getComponent", config: {} },
      ],
      edges: [
        { id: "e1", source: "e1n", target: "get", sourceHandle: "payload", targetHandle: "entity" },
        { id: "e2", source: "e2n", target: "get", sourceHandle: "payload", targetHandle: "entity" },
      ],
    };
    const { warn, messages } = makeWarn();
    expect(compileGraph(doc, nodeTypes, warn)).toBeUndefined();
    expect(messages[0]).toContain("already has an incoming edge");
  });

  it("rejects an edge that would create a cycle", () => {
    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "a", type: "core:destroyEntity", config: {} },
        { id: "b", type: "core:destroyEntity", config: {} },
      ],
      edges: [
        { id: "e1", source: "a", target: "b", sourceHandle: "flow", targetHandle: "flow" },
        { id: "e2", source: "b", target: "a", sourceHandle: "flow", targetHandle: "flow" },
      ],
    };
    const { warn, messages } = makeWarn();
    expect(compileGraph(doc, nodeTypes, warn)).toBeUndefined();
    expect(messages[0]).toContain("would create a cycle");
  });

  it("rejects a self-loop edge", () => {
    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [{ id: "a", type: "core:destroyEntity", config: {} }],
      edges: [{ id: "e1", source: "a", target: "a", sourceHandle: "flow", targetHandle: "flow" }],
    };
    const { warn, messages } = makeWarn();
    expect(compileGraph(doc, nodeTypes, warn)).toBeUndefined();
    expect(messages[0]).toContain("would create a cycle");
  });

  it("does not treat a node with no flow output at all as a trigger", () => {
    const doc: GraphDocumentData = { ...BASE, nodes: [{ id: "g", type: "core:getComponent", config: {} }], edges: [] };
    const { warn } = makeWarn();
    const graph = compileGraph(doc, nodeTypes, warn);
    expect(graph!.triggerNodeIds).toEqual([]);
  });
});
