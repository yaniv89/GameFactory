import type {
  ComponentHandle,
  ComponentJsonSchema,
  ComponentShape,
  EntityId,
  InterceptorMap,
  Logger,
  SetupContext,
  StorageApi,
  WorldApi,
} from "@forge/module-api";
import { beforeEach, describe, expect, it } from "vitest";
import { questsModule } from "../src/index";
import { MAX_OBJECTIVES_PER_QUEST, type QuestDefinitionConfig } from "../src/types";

/** Same fake-SetupContext shape as packages/modules/inventory/test/inventory.test.ts — see that file's comment for why this isn't shared via a new package (CLAUDE.md's "three similar lines beats a premature abstraction"). */
function makeFakeContext(config: Record<string, unknown> = {}) {
  const worldData = new Map<EntityId, Record<string, Record<string, boolean>>>();
  let nextId = 1;
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  const storageData = new Map<string, unknown>();
  const logs: Array<{ level: string; message: string; data?: unknown }> = [];

  const world: WorldApi = {
    create(components) {
      const id = nextId++;
      worldData.set(id, (components as Record<string, Record<string, boolean>>) ?? {});
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
      entity[component] = { ...(entity[component] ?? {}), ...(value as Record<string, boolean>) };
    },
    add(id, component, value) {
      const entity = worldData.get(id) ?? {};
      entity[component] = value as Record<string, boolean>;
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
    dataTables: {},
    engineVersion: "0.0.0-test",
    moduleName: "@test/quests",
    world,
    defineComponent<T extends ComponentShape>(name: string, _schema: ComponentJsonSchema, _defaults: T): ComponentHandle<T> {
      return { name };
    },
    addSystem() {
      throw new Error("@forge/quests does not register systems");
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
        for (const handler of [...(handlers.get(event as string) ?? [])]) handler(payload);
      },
    },
    addInterceptor() {
      throw new Error("@forge/quests registers no interceptor points");
    },
    runInterceptor<K extends keyof InterceptorMap>(_point: K, value: InterceptorMap[K]): InterceptorMap[K] {
      return value;
    },
    defineGraphNode() {
      // @forge/quests registers no graph node types itself — those live in
      // @forge/graph-nodes-core and call into this module's events instead.
    },
    storage,
    log: logger,
  };

  return { ctx, worldData, logs, storageData, emit: ctx.events.emit.bind(ctx.events) };
}

const KILL_WOLVES: QuestDefinitionConfig = {
  id: "killWolves",
  name: "Wolf Trouble",
  description: "Deal with the wolves near the mill.",
  objectives: [
    { id: "kill3Wolves", description: "Kill 3 wolves" },
    { id: "reportToElder", description: "Report back to the elder" },
  ],
};

describe("@forge/quests", () => {
  let harness: ReturnType<typeof makeFakeContext>;

  beforeEach(() => {
    harness = makeFakeContext({ quests: [KILL_WOLVES] });
    questsModule.setup(harness.ctx);
  });

  it("quest:start on a known quest activates it and emits quest:started", () => {
    const started: unknown[] = [];
    harness.ctx.events.on("quest:started", (p) => started.push(p));
    harness.emit("quest:start", { entity: 1, questId: "killWolves" });
    expect(started).toEqual([{ entity: 1, questId: "killWolves" }]);
    expect(harness.ctx.world.get(1, "Quest_killWolves")).toMatchObject({ active: true, completed: false });
  });

  it("quest:start on an unknown quest id is rejected", () => {
    const rejected: unknown[] = [];
    harness.ctx.events.on("quest:rejected", (p) => rejected.push(p));
    harness.emit("quest:start", { entity: 1, questId: "nope" });
    expect(rejected).toEqual([{ entity: 1, questId: "nope", reason: "unknownQuest" }]);
  });

  it("quest:start on an already-active quest is rejected", () => {
    harness.emit("quest:start", { entity: 1, questId: "killWolves" });
    const rejected: unknown[] = [];
    harness.ctx.events.on("quest:rejected", (p) => rejected.push(p));
    harness.emit("quest:start", { entity: 1, questId: "killWolves" });
    expect(rejected).toEqual([{ entity: 1, questId: "killWolves", reason: "alreadyActive" }]);
  });

  it("quest:completeObjective before quest:start is rejected as notActive", () => {
    const rejected: unknown[] = [];
    harness.ctx.events.on("quest:rejected", (p) => rejected.push(p));
    harness.emit("quest:completeObjective", { entity: 1, questId: "killWolves", objectiveId: "kill3Wolves" });
    expect(rejected).toEqual([{ entity: 1, questId: "killWolves", reason: "notActive" }]);
  });

  it("quest:completeObjective with an unknown objective id is rejected", () => {
    harness.emit("quest:start", { entity: 1, questId: "killWolves" });
    const rejected: unknown[] = [];
    harness.ctx.events.on("quest:rejected", (p) => rejected.push(p));
    harness.emit("quest:completeObjective", { entity: 1, questId: "killWolves", objectiveId: "nope" });
    expect(rejected).toEqual([{ entity: 1, questId: "killWolves", reason: "unknownObjective" }]);
  });

  it("completing one of two objectives emits quest:objectiveCompleted but not quest:completed", () => {
    harness.emit("quest:start", { entity: 1, questId: "killWolves" });
    const completed: unknown[] = [];
    const objectiveCompleted: unknown[] = [];
    harness.ctx.events.on("quest:completed", (p) => completed.push(p));
    harness.ctx.events.on("quest:objectiveCompleted", (p) => objectiveCompleted.push(p));

    harness.emit("quest:completeObjective", { entity: 1, questId: "killWolves", objectiveId: "kill3Wolves" });

    expect(objectiveCompleted).toEqual([{ entity: 1, questId: "killWolves", objectiveId: "kill3Wolves" }]);
    expect(completed).toEqual([]);
    expect(harness.ctx.world.get(1, "Quest_killWolves")).toMatchObject({ active: true, completed: false, obj0: true, obj1: false });
  });

  it("completing every objective emits quest:completed and deactivates the quest", () => {
    harness.emit("quest:start", { entity: 1, questId: "killWolves" });
    const completed: unknown[] = [];
    harness.ctx.events.on("quest:completed", (p) => completed.push(p));

    harness.emit("quest:completeObjective", { entity: 1, questId: "killWolves", objectiveId: "kill3Wolves" });
    harness.emit("quest:completeObjective", { entity: 1, questId: "killWolves", objectiveId: "reportToElder" });

    expect(completed).toEqual([{ entity: 1, questId: "killWolves" }]);
    expect(harness.ctx.world.get(1, "Quest_killWolves")).toMatchObject({ active: false, completed: true });
  });

  it("completing an already-completed objective a second time is idempotent — no duplicate event", () => {
    harness.emit("quest:start", { entity: 1, questId: "killWolves" });
    const objectiveCompleted: unknown[] = [];
    harness.ctx.events.on("quest:objectiveCompleted", (p) => objectiveCompleted.push(p));

    harness.emit("quest:completeObjective", { entity: 1, questId: "killWolves", objectiveId: "kill3Wolves" });
    harness.emit("quest:completeObjective", { entity: 1, questId: "killWolves", objectiveId: "kill3Wolves" });

    expect(objectiveCompleted).toEqual([{ entity: 1, questId: "killWolves", objectiveId: "kill3Wolves" }]);
  });

  it("quest:start on an already-completed quest is rejected as alreadyCompleted", () => {
    harness.emit("quest:start", { entity: 1, questId: "killWolves" });
    harness.emit("quest:completeObjective", { entity: 1, questId: "killWolves", objectiveId: "kill3Wolves" });
    harness.emit("quest:completeObjective", { entity: 1, questId: "killWolves", objectiveId: "reportToElder" });

    const rejected: unknown[] = [];
    harness.ctx.events.on("quest:rejected", (p) => rejected.push(p));
    harness.emit("quest:start", { entity: 1, questId: "killWolves" });
    expect(rejected).toEqual([{ entity: 1, questId: "killWolves", reason: "alreadyCompleted" }]);
  });

  it("quest:query on an entity with no state answers inactive, incomplete, no objectives done", () => {
    const queried: unknown[] = [];
    harness.ctx.events.on("quest:queried", (p) => queried.push(p));
    harness.emit("quest:query", { entity: 42, questId: "killWolves" });
    expect(queried).toEqual([{ entity: 42, questId: "killWolves", active: false, completed: false, completedObjectiveIds: [] }]);
  });

  it("quest:query reflects partial progress by objective id, not raw field index", () => {
    harness.emit("quest:start", { entity: 1, questId: "killWolves" });
    harness.emit("quest:completeObjective", { entity: 1, questId: "killWolves", objectiveId: "reportToElder" });

    const queried: unknown[] = [];
    harness.ctx.events.on("quest:queried", (p) => queried.push(p));
    harness.emit("quest:query", { entity: 1, questId: "killWolves" });
    expect(queried).toEqual([{ entity: 1, questId: "killWolves", active: true, completed: false, completedObjectiveIds: ["reportToElder"] }]);
  });

  it("a quest with more than MAX_OBJECTIVES_PER_QUEST objectives is truncated with a warning, not silently accepted whole", () => {
    const objectives = Array.from({ length: MAX_OBJECTIVES_PER_QUEST + 5 }, (_v, i) => ({ id: `o${i}`, description: `Objective ${i}` }));
    const oversized = makeFakeContext({ quests: [{ id: "huge", name: "Huge Quest", description: "", objectives }] });
    questsModule.setup(oversized.ctx);

    expect(oversized.logs.some((l) => l.level === "warn" && l.message.includes("more than"))).toBe(true);

    oversized.emit("quest:start", { entity: 1, questId: "huge" });
    const rejected: unknown[] = [];
    oversized.ctx.events.on("quest:rejected", (p) => rejected.push(p));
    oversized.emit("quest:completeObjective", { entity: 1, questId: "huge", objectiveId: `o${MAX_OBJECTIVES_PER_QUEST}` });
    expect(rejected).toEqual([{ entity: 1, questId: "huge", reason: "unknownObjective" }]);
  });

  it("a malformed quest in config.quests is skipped with a warning rather than crashing setup", () => {
    const malformed = makeFakeContext({ quests: [{ id: 42 }, KILL_WOLVES] });
    expect(() => questsModule.setup(malformed.ctx)).not.toThrow();
    expect(malformed.logs.some((l) => l.level === "warn" && l.message.includes("malformed"))).toBe(true);
  });
});
