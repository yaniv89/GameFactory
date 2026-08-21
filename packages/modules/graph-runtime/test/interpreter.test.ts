import { coreGraphNodes } from "@forge/graph-nodes-core";
import type { EntityId, EventBus, GraphNodeDefinition, WorldApi } from "@forge/module-api";
import { describe, expect, it } from "vitest";
import { compileGraph } from "../src/compileGraph";
import { attachGraph } from "../src/interpreter";
import type { GraphDocumentData } from "../src/types";

const nodeTypes = new Map<string, GraphNodeDefinition>(coreGraphNodes.map((n) => [n.type, n]));

function makeWorld(initial: ReadonlyMap<EntityId, Record<string, unknown>> = new Map()): WorldApi {
  const data = new Map(initial);
  let nextId = 1000;
  return {
    create(components) {
      const id = nextId++;
      data.set(id, { ...(components ?? {}) });
      return id;
    },
    destroy(id) {
      data.delete(id);
    },
    has(id, component) {
      return component in (data.get(id) ?? {});
    },
    get(id, component) {
      return data.get(id)?.[component] as never;
    },
    set(id, component, value) {
      const entity = data.get(id);
      if (!entity) throw new Error(`fake world: set() on unknown entity ${id}`);
      entity[component] = { ...(entity[component] as Record<string, unknown> | undefined), ...(value as Record<string, unknown>) };
    },
    add(id, component, value) {
      const entity = data.get(id) ?? {};
      entity[component] = value;
      data.set(id, entity);
    },
    remove(id, component) {
      delete data.get(id)?.[component];
    },
    query(components) {
      const ids = [...data.entries()].filter(([, entity]) => components.every((c) => c in entity)).map(([id]) => id);
      return { count: ids.length, forEach: (fn) => ids.forEach(fn) };
    },
  };
}

function makeEvents(): EventBus & { emit(event: string, payload: unknown): void } {
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  return {
    on(event, handler) {
      const list = handlers.get(event as string) ?? [];
      list.push(handler as (payload: unknown) => void);
      handlers.set(event as string, list);
      return () => {
        const idx = list.indexOf(handler as (payload: unknown) => void);
        if (idx !== -1) list.splice(idx, 1);
      };
    },
    off(event, handler) {
      const list = handlers.get(event as string);
      if (!list) return;
      const idx = list.indexOf(handler as (payload: unknown) => void);
      if (idx !== -1) list.splice(idx, 1);
    },
    emit(event: string, payload: unknown) {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
  };
}

function makeWarnLog() {
  const calls: Array<{ message: string; data?: Record<string, unknown> }> = [];
  return {
    warn: (message: string, data?: Record<string, unknown>) => calls.push(data === undefined ? { message } : { message, data }),
    calls,
  };
}

const BASE: GraphDocumentData = { id: "g1", name: "test graph", nodes: [], edges: [] };

describe("attachGraph + walkFlow (M5 interpreter)", () => {
  it("wires core:onEvent to a real events.on subscription and destroys the entity named by the payload on that event", () => {
    const world = makeWorld(new Map([[42, { Health: { hp: 10 } }]]));
    const events = makeEvents();
    const { warn } = makeWarnLog();

    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "trigger", type: "core:onEvent", config: { event: "enemy:died" } },
        { id: "destroy", type: "core:destroyEntity", config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "destroy", sourceHandle: "flow", targetHandle: "flow" },
        { id: "e2", source: "trigger", target: "destroy", sourceHandle: "payload", targetHandle: "entity" },
      ],
    };
    const graph = compileGraph(doc, nodeTypes, warn)!;
    expect(graph).toBeDefined();
    attachGraph(graph, world, events, warn);

    expect(world.has(42, "Health")).toBe(true);
    events.emit("enemy:died", 42);
    expect(world.has(42, "Health")).toBe(false);
  });

  it("does not fire for an unrelated event name", () => {
    const world = makeWorld(new Map([[1, { Health: {} }]]));
    const events = makeEvents();
    const { warn } = makeWarnLog();
    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "trigger", type: "core:onEvent", config: { event: "enemy:died" } },
        { id: "destroy", type: "core:destroyEntity", config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "destroy", sourceHandle: "flow", targetHandle: "flow" },
        { id: "e2", source: "trigger", target: "destroy", sourceHandle: "payload", targetHandle: "entity" },
      ],
    };
    const graph = compileGraph(doc, nodeTypes, warn)!;
    attachGraph(graph, world, events, warn);
    events.emit("something:else", 1);
    expect(world.has(1, "Health")).toBe(true);
  });

  it("resolves a pure data node (core:getComponent) feeding a branch condition, fed in turn by the trigger's own payload", () => {
    const world = makeWorld(new Map([[7, { Flag: { on: true } }]]));
    const events = makeEvents();
    const { warn } = makeWarnLog();

    // trigger(payload=entityId) -> branch(condition <- getComponent(entity <- trigger.payload).value)
    //   true -> destroyEntity(entity <- trigger.payload)
    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "trigger", type: "core:onEvent", config: { event: "check" } },
        { id: "get", type: "core:getComponent", config: { component: "Flag" } },
        { id: "branch", type: "core:branch", config: {} },
        { id: "destroy", type: "core:destroyEntity", config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "branch", sourceHandle: "flow", targetHandle: "flow" },
        { id: "e2", source: "trigger", target: "get", sourceHandle: "payload", targetHandle: "entity" },
        { id: "e3", source: "get", target: "branch", sourceHandle: "value", targetHandle: "condition" },
        { id: "e4", source: "branch", target: "destroy", sourceHandle: "true", targetHandle: "flow" },
        { id: "e5", source: "trigger", target: "destroy", sourceHandle: "payload", targetHandle: "entity" },
      ],
    };
    const graph = compileGraph(doc, nodeTypes, warn)!;
    expect(graph).toBeDefined();
    attachGraph(graph, world, events, warn);

    expect(world.has(7, "Flag")).toBe(true);
    events.emit("check", 7);
    expect(world.has(7, "Flag")).toBe(false);
  });

  it("a branch node whose condition resolves falsy takes the 'false' output, not 'true'", () => {
    const world = makeWorld(new Map([[8, {}]]));
    const events = makeEvents();
    const { warn } = makeWarnLog();
    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "trigger", type: "core:onEvent", config: { event: "check" } },
        { id: "get", type: "core:getComponent", config: { component: "Flag" } },
        { id: "branch", type: "core:branch", config: {} },
        { id: "destroy", type: "core:destroyEntity", config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "branch", sourceHandle: "flow", targetHandle: "flow" },
        { id: "e2", source: "trigger", target: "get", sourceHandle: "payload", targetHandle: "entity" },
        { id: "e3", source: "get", target: "branch", sourceHandle: "value", targetHandle: "condition" },
        { id: "e4", source: "branch", target: "destroy", sourceHandle: "true", targetHandle: "flow" },
        { id: "e5", source: "trigger", target: "destroy", sourceHandle: "payload", targetHandle: "entity" },
      ],
    };
    const graph = compileGraph(doc, nodeTypes, warn)!;
    attachGraph(graph, world, events, warn);
    events.emit("check", 8);
    // Falsy condition (getComponent found nothing) took branch's "false" output, which has no
    // wired edge at all — destroy was never reached, so entity 8 still exists.
    expect(world.query([]).count).toBe(1);
  });

  it("core:repeat walks its flow-output body N times, once per clamped iteration", () => {
    // V1's core node library (M2) has no numeric-literal node yet — a real
    // author-facing graph can't wire a constant into core:repeat's "count"
    // input without one. That gap is out of M5's scope (it's a node-library
    // addition, not an interpreter concern); this local test-only pure node
    // stands in for it just to exercise walkFlow's own repeat-count handling.
    const constantThreeNode: GraphNodeDefinition = {
      type: "test:constantThree",
      inputs: [],
      outputs: [{ name: "value", type: "number" }],
      execute: () => ({ value: 3 }),
    };
    const localNodeTypes = new Map(nodeTypes);
    localNodeTypes.set(constantThreeNode.type, constantThreeNode);

    const world = makeWorld();
    const events = makeEvents();
    const { warn } = makeWarnLog();

    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "trigger", type: "core:onEvent", config: { event: "spawn:wave" } },
        { id: "three", type: "test:constantThree", config: {} },
        { id: "repeat", type: "core:repeat", config: { ceiling: 10 } },
        { id: "create", type: "core:createEntity", config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "repeat", sourceHandle: "flow", targetHandle: "flow" },
        { id: "e2", source: "three", target: "repeat", sourceHandle: "value", targetHandle: "count" },
        { id: "e3", source: "repeat", target: "create", sourceHandle: "flow", targetHandle: "flow" },
      ],
    };
    const graph = compileGraph(doc, localNodeTypes, warn)!;
    expect(graph).toBeDefined();
    attachGraph(graph, world, events, warn);

    events.emit("spawn:wave", null);
    expect(world.query([]).count).toBe(3);
  });

  it("core:repeat's flow output IS the loop body — nothing continues linearly after it finishes (v1 limitation, stated in interpreter.ts's own doc comment)", () => {
    const constantTwoNode: GraphNodeDefinition = {
      type: "test:constantTwo",
      inputs: [],
      outputs: [{ name: "value", type: "number" }],
      execute: () => ({ value: 2 }),
    };
    const localNodeTypes = new Map(nodeTypes);
    localNodeTypes.set(constantTwoNode.type, constantTwoNode);

    const world = makeWorld();
    const events = makeEvents();
    const { warn } = makeWarnLog();
    const afterCalls: unknown[] = [];
    events.on("after:fired", (p) => afterCalls.push(p));

    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "trigger", type: "core:onEvent", config: { event: "go" } },
        { id: "two", type: "test:constantTwo", config: {} },
        { id: "repeat", type: "core:repeat", config: {} },
        { id: "create", type: "core:createEntity", config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "repeat", sourceHandle: "flow", targetHandle: "flow" },
        { id: "e2", source: "two", target: "repeat", sourceHandle: "value", targetHandle: "count" },
        { id: "e3", source: "repeat", target: "create", sourceHandle: "flow", targetHandle: "flow" },
      ],
    };
    const graph = compileGraph(doc, localNodeTypes, warn)!;
    attachGraph(graph, world, events, warn);
    events.emit("go", null);
    // repeat's own outputs.count (the resolved, clamped count) has no further
    // downstream consumer wired in this graph on purpose — walkFlow returns
    // right after running the loop body, per the interpreter's stated v1 shape.
    expect(world.query([]).count).toBe(2);
    expect(afterCalls).toEqual([]);
  });

  it("core:forEachEntity binds 'entity' to the current iteration and walks the loop body once per matched entity", () => {
    const world = makeWorld(
      new Map<EntityId, Record<string, unknown>>([
        [1, { Enemy: {} }],
        [2, { Enemy: {} }],
        [3, { Enemy: {} }],
      ]),
    );
    const events = makeEvents();
    const { warn } = makeWarnLog();

    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "trigger", type: "core:onEvent", config: { event: "clear" } },
        { id: "each", type: "core:forEachEntity", config: { components: ["Enemy"] } },
        { id: "destroy", type: "core:destroyEntity", config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "each", sourceHandle: "flow", targetHandle: "flow" },
        { id: "e2", source: "each", target: "destroy", sourceHandle: "flow", targetHandle: "flow" },
        { id: "e3", source: "each", target: "destroy", sourceHandle: "entity", targetHandle: "entity" },
      ],
    };
    const graph = compileGraph(doc, nodeTypes, warn)!;
    expect(graph).toBeDefined();
    attachGraph(graph, world, events, warn);

    expect(world.query(["Enemy"]).count).toBe(3);
    events.emit("clear", null);
    expect(world.query(["Enemy"]).count).toBe(0);
  });

  it("warns and skips a trigger node whose config.event is not a string, rather than throwing", () => {
    const world = makeWorld();
    const events = makeEvents();
    const { warn, calls } = makeWarnLog();
    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [{ id: "trigger", type: "core:onEvent", config: {} }],
      edges: [],
    };
    const graph = compileGraph(doc, nodeTypes, warn)!;
    const unsubscribes = attachGraph(graph, world, events, warn);
    expect(unsubscribes).toEqual([]);
    expect(calls.some((c) => c.message.includes("config.event is not a string"))).toBe(true);
  });

  it("catches an error thrown while interpreting a flow and reports it via warn instead of propagating", () => {
    const world = makeWorld();
    const events = makeEvents();
    const { warn, calls } = makeWarnLog();

    const throwingNode: GraphNodeDefinition = {
      type: "test:throws",
      inputs: [{ name: "flow", type: "flow" }],
      outputs: [{ name: "flow", type: "flow" }],
      execute() {
        throw new Error("boom");
      },
    };
    const localNodeTypes = new Map(nodeTypes);
    localNodeTypes.set(throwingNode.type, throwingNode);

    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "trigger", type: "core:onEvent", config: { event: "go" } },
        { id: "bad", type: "test:throws", config: {} },
      ],
      edges: [{ id: "e1", source: "trigger", target: "bad", sourceHandle: "flow", targetHandle: "flow" }],
    };
    const graph = compileGraph(doc, localNodeTypes, warn)!;
    attachGraph(graph, world, events, warn);

    expect(() => events.emit("go", null)).not.toThrow();
    expect(calls.some((c) => c.message.includes("uncaught error"))).toBe(true);
  });

  it("returns unsubscribe functions that stop the graph from reacting to further events", () => {
    const world = makeWorld(new Map([[5, { Health: {} }]]));
    const events = makeEvents();
    const { warn } = makeWarnLog();
    const doc: GraphDocumentData = {
      ...BASE,
      nodes: [
        { id: "trigger", type: "core:onEvent", config: { event: "die" } },
        { id: "destroy", type: "core:destroyEntity", config: {} },
      ],
      edges: [
        { id: "e1", source: "trigger", target: "destroy", sourceHandle: "flow", targetHandle: "flow" },
        { id: "e2", source: "trigger", target: "destroy", sourceHandle: "payload", targetHandle: "entity" },
      ],
    };
    const graph = compileGraph(doc, nodeTypes, warn)!;
    const unsubscribes = attachGraph(graph, world, events, warn);
    expect(unsubscribes).toHaveLength(1);
    unsubscribes[0]!();
    events.emit("die", 5);
    expect(world.has(5, "Health")).toBe(true);
  });
});
