import type {
  ComponentHandle,
  ComponentJsonSchema,
  ComponentShape,
  EntityId,
  GraphNodeDefinition,
  InterceptorMap,
  Logger,
  SetupContext,
  WorldApi,
} from "@forge/module-api";
import { beforeEach, describe, expect, it } from "vitest";
import { graphRuntimeModule } from "../src/index";

/**
 * A minimal, faithful fake of `SetupContext` — no QuickJS, no runtime-host.
 * Mirrors `packages/modules/dialogue/test/dialogue.test.ts`'s own fake
 * exactly: exercises `graphRuntimeModule.setup()` directly against the
 * public API contract. The bridge mechanism itself (that `defineGraphNode`
 * works correctly *inside* the real sandbox) is proven separately by
 * `packages/runtime-host/test/moduleBridge.test.ts` (M4) — this module
 * uses nothing beyond what's proven there.
 */
/**
 * `shared`, when passed, reuses another `makeFakeContext` call's own
 * `worldData`/`handlers` — the same "fresh node registry, same
 * persistent world/events" shape `PreviewApp.tsx` (M6) actually needs to
 * rebuild `graphRuntimeModule` in place: node-type registration
 * (`ctx.defineGraphNode`) is write-once per registry by design (matching
 * the real sandboxed `GraphNodeRegistry`'s own duplicate-registration
 * guard), so a rebuild can never reuse the same `ctx`/registry twice —
 * only the underlying world/events persist across one.
 */
function makeFakeContext(config: Record<string, unknown>, shared?: { worldData: Map<EntityId, Record<string, unknown>>; handlers: Map<string, Array<(payload: unknown) => void>> }) {
  const worldData = shared?.worldData ?? new Map<EntityId, Record<string, unknown>>();
  let nextId = worldData.size + 1;
  const handlers = shared?.handlers ?? new Map<string, Array<(payload: unknown) => void>>();
  const graphNodes = new Map<string, GraphNodeDefinition>();
  const logs: Array<{ level: string; message: string; data?: unknown }> = [];

  const world: WorldApi = {
    create(components) {
      const id = nextId++;
      worldData.set(id, { ...(components as Record<string, unknown> | undefined) });
      return id;
    },
    destroy(id) {
      worldData.delete(id);
    },
    has(id, component) {
      return component in (worldData.get(id) ?? {});
    },
    get(id, component) {
      return worldData.get(id)?.[component] as never;
    },
    set(id, component, value) {
      const entity = worldData.get(id);
      if (!entity) throw new Error(`fake world: set() on unknown entity ${id}`);
      entity[component] = { ...(entity[component] as Record<string, unknown> | undefined), ...(value as Record<string, unknown>) };
    },
    add(id, component, value) {
      const entity = worldData.get(id) ?? {};
      entity[component] = value;
      worldData.set(id, entity);
    },
    remove(id, component) {
      delete worldData.get(id)?.[component];
    },
    query(components) {
      const ids = [...worldData.entries()].filter(([, data]) => components.every((c) => c in data)).map(([id]) => id);
      return { count: ids.length, forEach: (fn) => ids.forEach(fn) };
    },
  };

  const logger: Logger = {
    debug: (message, data) => logs.push({ level: "debug", message, data }),
    info: (message, data) => logs.push({ level: "info", message, data }),
    warn: (message, data) => logs.push({ level: "warn", message, data }),
    error: (message, data) => logs.push({ level: "error", message, data }),
  };

  const ctx: SetupContext = {
    config,
    dataTables: {},
    engineVersion: "0.0.0-test",
    moduleName: "@test/graph-runtime",
    world,
    defineComponent<T extends ComponentShape>(name: string, _schema: ComponentJsonSchema, _defaults: T): ComponentHandle<T> {
      return { name };
    },
    addSystem() {
      throw new Error("@forge/graph-runtime should never call addSystem — see src/index.ts's own doc comment");
    },
    events: {
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
      emit(event, payload) {
        for (const handler of handlers.get(event as string) ?? []) handler(payload);
      },
    },
    addInterceptor() {
      throw new Error("@forge/graph-runtime should never call addInterceptor");
    },
    runInterceptor<K extends keyof InterceptorMap>(_point: K, value: InterceptorMap[K]): InterceptorMap[K] {
      return value;
    },
    defineGraphNode(def) {
      if (graphNodes.has(def.type)) throw new Error(`duplicate graph node type "${def.type}"`);
      graphNodes.set(def.type, def);
    },
    storage: {
      get: () => undefined as never,
      set: () => {},
      delete: () => {},
    },
    log: logger,
  };

  return { ctx, worldData, graphNodes, logs, emit: ctx.events.emit.bind(ctx.events) };
}

describe("@forge/graph-runtime module setup", () => {
  it("registers every core node type from @forge/graph-nodes-core via ctx.defineGraphNode", () => {
    const harness = makeFakeContext({});
    graphRuntimeModule.setup(harness.ctx);
    expect(harness.graphNodes.has("core:onEvent")).toBe(true);
    expect(harness.graphNodes.has("core:repeat")).toBe(true);
    expect(harness.graphNodes.has("core:forEachEntity")).toBe(true);
    expect(harness.graphNodes.size).toBeGreaterThanOrEqual(19);
  });

  it("with no config.graphs, registers node types but attaches nothing (no crash on an absent field)", () => {
    const harness = makeFakeContext({});
    expect(() => graphRuntimeModule.setup(harness.ctx)).not.toThrow();
  });

  it("skips a malformed entry in config.graphs and logs a warning, without throwing", () => {
    const harness = makeFakeContext({ graphs: [{ id: "bad" /* missing name/nodes/edges */ }] });
    expect(() => graphRuntimeModule.setup(harness.ctx)).not.toThrow();
    expect(harness.logs.some((l) => l.level === "warn" && l.message.includes("malformed entry"))).toBe(true);
  });

  it("compiles a well-formed graph from config.graphs and attaches it — an emitted event actually runs it end to end", () => {
    harnessDrivesRealGraph();
  });

  function harnessDrivesRealGraph() {
    const harness = makeFakeContext({
      graphs: [
        {
          id: "g1",
          name: "kill on event",
          nodes: [
            { id: "trigger", type: "core:onEvent", config: { event: "enemy:died" } },
            { id: "destroy", type: "core:destroyEntity", config: {} },
          ],
          edges: [
            { id: "e1", source: "trigger", target: "destroy", sourceHandle: "flow", targetHandle: "flow" },
            { id: "e2", source: "trigger", target: "destroy", sourceHandle: "payload", targetHandle: "entity" },
          ],
        },
      ],
    });
    graphRuntimeModule.setup(harness.ctx);
    const id = harness.ctx.world.create({ Health: {} });
    expect(harness.ctx.world.has(id, "Health")).toBe(true);
    harness.emit("enemy:died", id);
    expect(harness.ctx.world.has(id, "Health")).toBe(false);
  }

  it("skips an individually-invalid graph in config.graphs (unknown node type) without affecting a valid sibling graph", () => {
    const harness = makeFakeContext({
      graphs: [
        {
          id: "bad-graph",
          name: "broken",
          nodes: [{ id: "n", type: "acme:doesNotExist", config: {} }],
          edges: [],
        },
        {
          id: "good-graph",
          name: "fine",
          nodes: [
            { id: "trigger", type: "core:onEvent", config: { event: "go" } },
            { id: "destroy", type: "core:destroyEntity", config: {} },
          ],
          edges: [
            { id: "e1", source: "trigger", target: "destroy", sourceHandle: "flow", targetHandle: "flow" },
            { id: "e2", source: "trigger", target: "destroy", sourceHandle: "payload", targetHandle: "entity" },
          ],
        },
      ],
    });
    graphRuntimeModule.setup(harness.ctx);
    expect(harness.logs.some((l) => l.level === "warn" && l.message.includes("unknown node type"))).toBe(true);

    const id = harness.ctx.world.create({ Health: {} });
    harness.emit("go", id);
    expect(harness.ctx.world.has(id, "Health")).toBe(false);
  });

  it("teardown() unsubscribes every attached trigger — a later event no longer reaches the (torn-down) graph, matching what PreviewApp.tsx (M6) relies on for a rebuild-in-place", () => {
    const harness = makeFakeContext({
      graphs: [
        {
          id: "g1",
          name: "kill on event",
          nodes: [
            { id: "trigger", type: "core:onEvent", config: { event: "enemy:died" } },
            { id: "destroy", type: "core:destroyEntity", config: {} },
          ],
          edges: [
            { id: "e1", source: "trigger", target: "destroy", sourceHandle: "flow", targetHandle: "flow" },
            { id: "e2", source: "trigger", target: "destroy", sourceHandle: "payload", targetHandle: "entity" },
          ],
        },
      ],
    });
    graphRuntimeModule.setup(harness.ctx);
    graphRuntimeModule.teardown?.({ moduleName: "@test/graph-runtime" });

    const id = harness.ctx.world.create({ Health: {} });
    harness.emit("enemy:died", id);
    expect(harness.ctx.world.has(id, "Health")).toBe(true); // never destroyed — the graph was torn down before this event fired
  });

  it("setup() called again after teardown() re-attaches cleanly, with no leftover double-firing from the first attachment", () => {
    const graphs = [
      {
        id: "g1",
        name: "kill on event",
        nodes: [
          { id: "trigger", type: "core:onEvent", config: { event: "enemy:died" } },
          { id: "destroy", type: "core:destroyEntity", config: {} },
        ],
        edges: [
          { id: "e1", source: "trigger", target: "destroy", sourceHandle: "flow", targetHandle: "flow" },
          { id: "e2", source: "trigger", target: "destroy", sourceHandle: "payload", targetHandle: "entity" },
        ],
      },
    ];
    // Node-type registration is write-once per registry by design
    // (`ctx.defineGraphNode` throws on a duplicate `type`, matching the
    // real sandboxed `GraphNodeRegistry`) — so a rebuild can never reuse
    // the same `ctx` twice, only the underlying world/events it shares
    // with the rest of the running game (`PreviewApp.tsx`'s own real
    // shape, M6). `shared` here is exactly that: a second, independent
    // `ctx` (fresh node registry) reusing the first's `worldData`/`handlers`.
    const first = makeFakeContext({ graphs });
    graphRuntimeModule.setup(first.ctx);
    graphRuntimeModule.teardown?.({ moduleName: "@test/graph-runtime" });

    const second = makeFakeContext({ graphs }, { worldData: first.worldData, handlers: new Map() });
    graphRuntimeModule.setup(second.ctx);

    const id = second.ctx.world.create({ Health: {} });
    second.emit("enemy:died", id);
    expect(second.ctx.world.has(id, "Health")).toBe(false); // the fresh attachment still works

    // And the torn-down first attachment's subscription is gone — emitting
    // on the *first* harness's own (now-orphaned) handlers map proves
    // nothing from the old attachment is still listening.
    const staleId = first.ctx.world.create({ Health: {} });
    first.emit("enemy:died", staleId);
    expect(first.ctx.world.has(staleId, "Health")).toBe(true);
  });
});
