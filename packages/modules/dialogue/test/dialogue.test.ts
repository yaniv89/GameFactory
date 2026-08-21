import type {
  ComponentHandle,
  ComponentJsonSchema,
  ComponentShape,
  EntityId,
  InterceptorMap,
  Logger,
  SetupContext,
  StorageApi,
  SystemDefinition,
  WorldApi,
} from "@forge/module-api";
import { beforeEach, describe, expect, it } from "vitest";
import { dialogueModule } from "../src/index";
import type { DialogueTreeConfig } from "../src/types";

/**
 * A minimal, faithful fake of SetupContext — no QuickJS, no runtime-host.
 * This exercises the dialogue module's own logic directly against the
 * public API contract; the bridge mechanism itself (that these same
 * primitives work correctly *inside* the real sandbox) is proven
 * separately by packages/runtime-host/test/moduleBridge.test.ts, whose
 * 37 tests already cover defineComponent/addSystem/events/runInterceptor/
 * ctx.world end to end — this module uses nothing beyond what's proven
 * there.
 */
function makeFakeContext(config: Record<string, unknown>) {
  const worldData = new Map<EntityId, Record<string, Record<string, number>>>();
  let nextId = 1;
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  const systems: SystemDefinition[] = [];
  const interceptorFns = new Map<string, (value: unknown) => unknown>();
  const storageData = new Map<string, unknown>();
  const logs: Array<{ level: string; message: string; data?: unknown }> = [];

  const world: WorldApi = {
    create(components) {
      const id = nextId++;
      worldData.set(id, (components as Record<string, Record<string, number>>) ?? {});
      return id;
    },
    destroy(id) {
      worldData.delete(id);
    },
    has(id, component) {
      return !!worldData.get(id)?.[component];
    },
    get(id, component) {
      return worldData.get(id)?.[component] as never;
    },
    set(id, component, value) {
      const entity = worldData.get(id);
      if (!entity) throw new Error(`fake world: set() on unknown entity ${id}`);
      entity[component] = { ...(entity[component] ?? {}), ...(value as Record<string, number>) };
    },
    add(id, component, value) {
      const entity = worldData.get(id) ?? {};
      entity[component] = value as Record<string, number>;
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

  const storage: StorageApi = {
    get: (key) => storageData.get(key) as never,
    set: (key, value) => void storageData.set(key, value),
    delete: (key) => void storageData.delete(key),
  };

  const ctx: SetupContext = {
    config,
    engineVersion: "0.0.0-test",
    moduleName: "@test/dialogue",
    world,
    defineComponent<T extends ComponentShape>(_name: string, _schema: ComponentJsonSchema, _defaults: T): ComponentHandle<T> {
      return { name: _name };
    },
    addSystem(def) {
      systems.push(def);
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
    addInterceptor(point, _priority, fn) {
      interceptorFns.set(point as string, fn as (value: unknown) => unknown);
    },
    runInterceptor<K extends keyof InterceptorMap>(point: K, value: InterceptorMap[K]): InterceptorMap[K] {
      const fn = interceptorFns.get(point as string);
      return fn ? (fn(value) as InterceptorMap[K]) : value;
    },
    defineGraphNode() {
      // @forge/dialogue registers no graph node types — this fake exists
      // only to satisfy SetupContext's shape (docs/adr/0017, M4).
    },
    storage,
    log: logger,
  };

  return { ctx, worldData, systems, logs, storageData, emit: ctx.events.emit.bind(ctx.events) };
}

const SIMPLE_TREE: DialogueTreeConfig = {
  id: "shopkeeper",
  nodes: [
    {
      speaker: "Shopkeeper",
      text: "Welcome to my shop.",
      choices: [
        { id: "buy", text: "I'd like to buy something.", next: 1 },
        { id: "leave", text: "Nevermind.", next: -1 },
      ],
    },
    { speaker: "Shopkeeper", text: "What would you like?" },
  ],
};

describe("@forge/dialogue", () => {
  let harness: ReturnType<typeof makeFakeContext>;

  beforeEach(() => {
    harness = makeFakeContext({ trees: [SIMPLE_TREE] });
    dialogueModule.setup(harness.ctx);
  });

  it("dialogue:start with an unknown tree id logs an error and shows nothing", () => {
    const shown: unknown[] = [];
    harness.ctx.events.on("dialogue:shown", (p) => shown.push(p));
    harness.emit("dialogue:start", { entity: 1, treeId: "does-not-exist" });
    expect(shown).toEqual([]);
    expect(harness.logs.some((l) => l.level === "error" && l.message.includes("unknown tree id"))).toBe(true);
  });

  it("dialogue:start shows the first node and its choices", () => {
    const shown: unknown[] = [];
    const choicesShown: unknown[] = [];
    harness.ctx.events.on("dialogue:shown", (p) => shown.push(p));
    harness.ctx.events.on("dialogue:choicesShown", (p) => choicesShown.push(p));

    harness.emit("dialogue:start", { entity: 1, treeId: "shopkeeper" });

    expect(shown).toEqual([{ entity: 1, speaker: "Shopkeeper", text: "Welcome to my shop.", locale: "en" }]);
    expect(choicesShown).toEqual([
      { entity: 1, choices: [{ id: "buy", text: "I'd like to buy something." }, { id: "leave", text: "Nevermind." }] },
    ]);
    expect(harness.worldData.get(1)!.DialogueState).toMatchObject({ active: true, tree: 0, node: 0 });
  });

  it("dialogue:choose with next: -1 ends the dialogue and marks it completed in storage", () => {
    const ended: unknown[] = [];
    harness.ctx.events.on("dialogue:ended", (p) => ended.push(p));

    harness.emit("dialogue:start", { entity: 1, treeId: "shopkeeper" });
    harness.emit("dialogue:choose", { entity: 1, choiceId: "leave" });

    expect(ended).toEqual([{ entity: 1, treeId: "shopkeeper" }]);
    expect(harness.worldData.get(1)!.DialogueState).toMatchObject({ active: false });
    expect(harness.storageData.get("completed:shopkeeper")).toBe(true);
  });

  it("dialogue:choose with a real next index advances to that node", () => {
    const shown: unknown[] = [];
    harness.ctx.events.on("dialogue:shown", (p) => shown.push(p));

    harness.emit("dialogue:start", { entity: 1, treeId: "shopkeeper" });
    harness.emit("dialogue:choose", { entity: 1, choiceId: "buy" });

    expect(shown).toEqual([
      { entity: 1, speaker: "Shopkeeper", text: "Welcome to my shop.", locale: "en" },
      { entity: 1, speaker: "Shopkeeper", text: "What would you like?", locale: "en" },
    ]);
    // Node 1 has no choices -> the dialogue ends automatically after showing it.
    expect(harness.worldData.get(1)!.DialogueState).toMatchObject({ active: false });
  });

  it("dialogue:choose with an unknown choice id logs an error and does not advance", () => {
    harness.emit("dialogue:start", { entity: 1, treeId: "shopkeeper" });
    const stateBefore = { ...harness.worldData.get(1)!.DialogueState };

    harness.emit("dialogue:choose", { entity: 1, choiceId: "does-not-exist" });

    expect(harness.worldData.get(1)!.DialogueState).toEqual(stateBefore);
    expect(harness.logs.some((l) => l.level === "error" && l.message.includes("unknown choice id"))).toBe(true);
  });

  it("dialogue:choose for an entity with no active dialogue logs a warning", () => {
    harness.emit("dialogue:choose", { entity: 99, choiceId: "buy" });
    expect(harness.logs.some((l) => l.level === "warn" && l.message.includes("no active dialogue"))).toBe(true);
  });

  it("runs dialogue:line and dialogue:choices through ctx.runInterceptor, so a filter can transform the output", () => {
    harness.ctx.addInterceptor("dialogue:line", 10, (value) => ({ ...value, text: value.text.toUpperCase() }));
    harness.ctx.addInterceptor("dialogue:choices", 10, (value) => ({
      choices: value.choices.map((c) => ({ id: c.id, text: `> ${c.text}` })),
    }));

    const shown: unknown[] = [];
    const choicesShown: unknown[] = [];
    harness.ctx.events.on("dialogue:shown", (p) => shown.push(p));
    harness.ctx.events.on("dialogue:choicesShown", (p) => choicesShown.push(p));

    harness.emit("dialogue:start", { entity: 1, treeId: "shopkeeper" });

    expect(shown).toEqual([{ entity: 1, speaker: "Shopkeeper", text: "WELCOME TO MY SHOP.", locale: "en" }]);
    expect((choicesShown[0] as { choices: unknown }).choices).toEqual([
      { id: "buy", text: "> I'd like to buy something." },
      { id: "leave", text: "> Nevermind." },
    ]);
  });

  it("skips a malformed tree in config.trees with a warning, keeping valid ones usable", () => {
    const h = makeFakeContext({ trees: [{ id: "ok", nodes: [{ speaker: "A", text: "hi" }] }, { nodes: [] }, "not-a-tree"] });
    dialogueModule.setup(h.ctx);

    expect(h.logs.filter((l) => l.level === "warn" && l.message.includes("malformed tree"))).toHaveLength(2);

    const shown: unknown[] = [];
    h.ctx.events.on("dialogue:shown", (p) => shown.push(p));
    h.emit("dialogue:start", { entity: 1, treeId: "ok" });
    expect(shown).toEqual([{ entity: 1, speaker: "A", text: "hi", locale: "en" }]);
  });

  it("registers exactly one Update-phase system for auto-advance, over the DialogueState component", () => {
    expect(harness.systems).toHaveLength(1);
    expect(harness.systems[0]).toMatchObject({ id: "autoAdvance", phase: "Update", query: ["DialogueState"] });
  });

  it("auto-advance counts down and, on elapse, advances to the first choice", () => {
    const h = makeFakeContext({
      trees: [
        {
          id: "timed",
          nodes: [
            { speaker: "A", text: "line one", autoAdvanceSec: 1, choices: [{ id: "next", text: "...", next: 1 }] },
            { speaker: "A", text: "line two" },
          ],
        },
      ],
    });
    dialogueModule.setup(h.ctx);
    const shown: unknown[] = [];
    h.ctx.events.on("dialogue:shown", (p) => shown.push(p));
    h.emit("dialogue:start", { entity: 1, treeId: "timed" });
    expect(shown).toHaveLength(1);

    const system = h.systems[0]!;
    const tick = { dt: 0.6, alpha: 0, elapsed: 0, frame: 0, world: h.ctx.world, input: undefined as never, scene: undefined as never };
    const entities = { count: 1, forEach: (fn: (id: EntityId) => void) => fn(1) };

    system.run(tick, entities); // 1 - 0.6 = 0.4s remaining, not yet elapsed
    expect(shown).toHaveLength(1);

    system.run(tick, entities); // 0.4 - 0.6 <= 0 -> elapses, auto-advances via dialogue:choose
    expect(shown).toHaveLength(2);
    expect(shown[1]).toEqual({ entity: 1, speaker: "A", text: "line two", locale: "en" });
  });

  it("auto-advance ends the dialogue on elapse when the node has no choices", () => {
    const h = makeFakeContext({
      trees: [{ id: "timed-end", nodes: [{ speaker: "A", text: "bye", autoAdvanceSec: 0.5 }] }],
    });
    dialogueModule.setup(h.ctx);
    const elapsed: unknown[] = [];
    const ended: unknown[] = [];
    h.ctx.events.on("dialogue:autoAdvanceElapsed", (p) => elapsed.push(p));
    h.ctx.events.on("dialogue:ended", (p) => ended.push(p));
    h.emit("dialogue:start", { entity: 1, treeId: "timed-end" });

    // The node has no choices, so showNode() already ended the dialogue synchronously —
    // DialogueState.active is false and the auto-advance system has nothing to do.
    expect(ended).toEqual([{ entity: 1, treeId: "timed-end" }]);
    expect(harness).toBeDefined(); // keep outer harness referenced for lint
    const system = h.systems[0]!;
    const tick = { dt: 1, alpha: 0, elapsed: 0, frame: 0, world: h.ctx.world, input: undefined as never, scene: undefined as never };
    system.run(tick, { count: 1, forEach: (fn: (id: EntityId) => void) => fn(1) });
    expect(elapsed).toEqual([]); // already inactive, the system's own guard skips it
  });
});
