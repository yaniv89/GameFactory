import { describe, expect, it } from "vitest";
import { isValidConnection, type GraphValidationEdge, type GraphValidationNode } from "./graphValidation";

const NODES: GraphValidationNode[] = [
  { id: "add1", type: "core:add" },
  { id: "add2", type: "core:add" },
  { id: "add3", type: "core:add" },
  { id: "branch1", type: "core:branch" },
  { id: "getComponent1", type: "core:getComponent" },
  { id: "createEntity1", type: "core:createEntity" },
  { id: "destroyEntity1", type: "core:destroyEntity" },
];

describe("isValidConnection", () => {
  it("accepts a matching data-type connection (number -> number)", () => {
    const result = isValidConnection(NODES, [], { source: "add1", sourceHandle: "result", target: "add2", targetHandle: "a" });
    expect(result).toEqual({ valid: true });
  });

  it("rejects a mismatched data-type connection (number -> boolean)", () => {
    const result = isValidConnection(NODES, [], { source: "add1", sourceHandle: "result", target: "branch1", targetHandle: "condition" });
    expect(result.valid).toBe(false);
  });

  it("accepts a connection into an 'any' socket regardless of the source type", () => {
    const result = isValidConnection(NODES, [], {
      source: "getComponent1",
      sourceHandle: "value",
      target: "branch1",
      targetHandle: "condition",
    });
    expect(result).toEqual({ valid: true });
  });

  it("rejects a flow output connecting to a data input — flow never mixes with a data type", () => {
    const result = isValidConnection(NODES, [], {
      source: "createEntity1",
      sourceHandle: "flow",
      target: "add1",
      targetHandle: "a",
    });
    expect(result.valid).toBe(false);
  });

  it("accepts a flow-to-flow connection", () => {
    const result = isValidConnection(NODES, [], {
      source: "createEntity1",
      sourceHandle: "flow",
      target: "destroyEntity1",
      targetHandle: "flow",
    });
    expect(result).toEqual({ valid: true });
  });

  it("rejects a reference to a socket name that doesn't exist on that node type", () => {
    const bySourceHandle = isValidConnection(NODES, [], { source: "add1", sourceHandle: "nope", target: "add2", targetHandle: "a" });
    expect(bySourceHandle.valid).toBe(false);
    const byTargetHandle = isValidConnection(NODES, [], { source: "add1", sourceHandle: "result", target: "add2", targetHandle: "nope" });
    expect(byTargetHandle.valid).toBe(false);
  });

  it("rejects a connection into a node that no longer exists", () => {
    const result = isValidConnection(NODES, [], { source: "add1", sourceHandle: "result", target: "ghost", targetHandle: "a" });
    expect(result.valid).toBe(false);
  });

  it("rejects a second wire into a data input that already has one", () => {
    const existing: GraphValidationEdge[] = [{ source: "add1", sourceHandle: "result", target: "add2", targetHandle: "a" }];
    const result = isValidConnection(NODES, existing, { source: "getComponent1", sourceHandle: "value", target: "add2", targetHandle: "a" });
    expect(result.valid).toBe(false);
  });

  it("allows a data output to fan out to multiple targets", () => {
    const existing: GraphValidationEdge[] = [{ source: "add1", sourceHandle: "result", target: "add2", targetHandle: "a" }];
    const result = isValidConnection(NODES, existing, { source: "add1", sourceHandle: "result", target: "add2", targetHandle: "b" });
    expect(result).toEqual({ valid: true });
  });

  it("rejects a second wire out of a flow output that already continues somewhere", () => {
    const existing: GraphValidationEdge[] = [
      { source: "createEntity1", sourceHandle: "flow", target: "destroyEntity1", targetHandle: "flow" },
    ];
    const result = isValidConnection(NODES, existing, {
      source: "createEntity1",
      sourceHandle: "flow",
      target: "destroyEntity1",
      targetHandle: "flow",
    });
    // Same exact edge again — still hits the "already continues somewhere
    // else" rule, since the flow output already has an outgoing wire.
    expect(result.valid).toBe(false);
  });

  it("rejects a self-loop", () => {
    const result = isValidConnection(NODES, [], { source: "add1", sourceHandle: "result", target: "add1", targetHandle: "a" });
    expect(result.valid).toBe(false);
  });

  it("rejects a connection that would close a cycle across multiple hops (all same-typed sockets, so this is genuinely the cycle rule firing, not a type mismatch)", () => {
    const existing: GraphValidationEdge[] = [
      { source: "add1", sourceHandle: "result", target: "add2", targetHandle: "a" },
      { source: "add2", sourceHandle: "result", target: "add3", targetHandle: "a" },
    ];
    // add3 -> add1 would close the loop: add1 -> add2 -> add3 -> add1.
    const result = isValidConnection(NODES, existing, { source: "add3", sourceHandle: "result", target: "add1", targetHandle: "b" });
    expect(result.valid).toBe(false);
  });

  it("accepts a connection that shares an upstream node but doesn't loop back", () => {
    const existing: GraphValidationEdge[] = [{ source: "add1", sourceHandle: "result", target: "add2", targetHandle: "a" }];
    const result = isValidConnection(NODES, existing, { source: "add1", sourceHandle: "result", target: "add3", targetHandle: "a" });
    expect(result).toEqual({ valid: true });
  });
});
