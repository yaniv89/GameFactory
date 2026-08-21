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
import { inventoryModule } from "../src/index";
import { INVENTORY_CAPACITY_COMPONENT } from "../src/types";

/** Same fake-SetupContext shape as packages/modules/dialogue/test/dialogue.test.ts — see that file's comment for why this isn't shared via a new package (CLAUDE.md's "three similar lines beats a premature abstraction"). */
function makeFakeContext(config: Record<string, unknown> = {}) {
  const worldData = new Map<EntityId, Record<string, Record<string, number>>>();
  let nextId = 1;
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
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
    moduleName: "@test/inventory",
    world,
    defineComponent<T extends ComponentShape>(name: string, _schema: ComponentJsonSchema, _defaults: T): ComponentHandle<T> {
      return { name };
    },
    addSystem() {
      throw new Error("@forge/inventory does not register systems");
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
    addInterceptor(point, _priority, fn) {
      interceptorFns.set(point as string, fn as (value: unknown) => unknown);
    },
    runInterceptor<K extends keyof InterceptorMap>(point: K, value: InterceptorMap[K]): InterceptorMap[K] {
      const fn = interceptorFns.get(point as string);
      return fn ? (fn(value) as InterceptorMap[K]) : value;
    },
    defineGraphNode() {
      // @forge/inventory registers no graph node types — this fake exists
      // only to satisfy SetupContext's shape (docs/adr/0017, M4).
    },
    storage,
    log: logger,
  };

  return { ctx, worldData, logs, storageData, emit: ctx.events.emit.bind(ctx.events) };
}

describe("@forge/inventory", () => {
  let harness: ReturnType<typeof makeFakeContext>;

  beforeEach(() => {
    harness = makeFakeContext();
    inventoryModule.setup(harness.ctx);
  });

  it("inventory:add creates a new stack and emits inventory:changed with the total", () => {
    const changed: unknown[] = [];
    harness.ctx.events.on("inventory:changed", (p) => changed.push(p));
    harness.emit("inventory:add", { entity: 1, itemId: "potion", qty: 3 });
    expect(changed).toEqual([{ entity: 1, itemId: "potion", qty: 3 }]);
    expect(harness.storageData.get("inv:1")).toEqual({ potion: 3 });
  });

  it("inventory:add on an existing stack accumulates the quantity", () => {
    harness.emit("inventory:add", { entity: 1, itemId: "potion", qty: 3 });
    harness.emit("inventory:add", { entity: 1, itemId: "potion", qty: 2 });
    expect(harness.storageData.get("inv:1")).toEqual({ potion: 5 });
  });

  it("inventory:add with a non-positive qty is ignored", () => {
    harness.emit("inventory:add", { entity: 1, itemId: "potion", qty: 0 });
    expect(harness.storageData.get("inv:1")).toBeUndefined();
    expect(harness.logs.some((l) => l.level === "warn")).toBe(true);
  });

  it("inventory:remove reduces the stack and deletes it at zero", () => {
    harness.emit("inventory:add", { entity: 1, itemId: "potion", qty: 3 });
    const changed: unknown[] = [];
    harness.ctx.events.on("inventory:changed", (p) => changed.push(p));

    harness.emit("inventory:remove", { entity: 1, itemId: "potion", qty: 3 });
    expect(changed).toEqual([{ entity: 1, itemId: "potion", qty: 0 }]);
    expect(harness.storageData.get("inv:1")).toEqual({});
  });

  it("inventory:remove of more than held logs a warning and changes nothing", () => {
    harness.emit("inventory:add", { entity: 1, itemId: "potion", qty: 1 });
    harness.emit("inventory:remove", { entity: 1, itemId: "potion", qty: 5 });
    expect(harness.storageData.get("inv:1")).toEqual({ potion: 1 });
    expect(harness.logs.some((l) => l.level === "warn" && l.message.includes("more than"))).toBe(true);
  });

  it("rejects a new stack past capacity via inventory:canAddItem, and a third-party module can veto too", () => {
    const entity = harness.ctx.world.create({ [INVENTORY_CAPACITY_COMPONENT]: { maxSlots: 1 } });
    harness.emit("inventory:add", { entity, itemId: "sword", qty: 1 });

    const rejected: unknown[] = [];
    harness.ctx.events.on("inventory:rejected", (p) => rejected.push(p));
    harness.emit("inventory:add", { entity, itemId: "shield", qty: 1 }); // would be a 2nd distinct stack, over capacity 1

    expect(rejected).toEqual([{ entity, itemId: "shield", qty: 1, reason: "capacity" }]);
    expect(harness.storageData.get(`inv:${entity}`)).toEqual({ sword: 1 });
  });

  it("a module registering inventory:canAddItem can veto an add the capacity check would have allowed", () => {
    harness.ctx.addInterceptor("inventory:canAddItem", 5, (value) =>
      value.itemId === "contraband" ? { ...value, allowed: false } : value,
    );
    const rejected: unknown[] = [];
    harness.ctx.events.on("inventory:rejected", (p) => rejected.push(p));

    harness.emit("inventory:add", { entity: 1, itemId: "contraband", qty: 1 });
    expect(rejected).toEqual([{ entity: 1, itemId: "contraband", qty: 1, reason: "capacity" }]);
  });

  it("inventory:buy runs inventory:itemPrice, emits inventory:purchase, and adds the item", () => {
    harness.ctx.addInterceptor("inventory:itemPrice", 10, (value) => ({ ...value, basePrice: value.basePrice * 0.5 })); // 50% off sale
    const purchases: unknown[] = [];
    const changed: unknown[] = [];
    harness.ctx.events.on("inventory:purchase", (p) => purchases.push(p));
    harness.ctx.events.on("inventory:changed", (p) => changed.push(p));

    harness.emit("inventory:buy", { entity: 1, itemId: "potion", qty: 2, vendor: 99, basePrice: 10 });

    expect(purchases).toEqual([{ entity: 1, itemId: "potion", qty: 2, totalPrice: 10 }]); // (10 * 0.5) * 2
    expect(changed).toEqual([{ entity: 1, itemId: "potion", qty: 2 }]);
  });

  it("inventory:query answers with the entity's current contents", () => {
    harness.emit("inventory:add", { entity: 1, itemId: "potion", qty: 3 });
    harness.emit("inventory:add", { entity: 1, itemId: "sword", qty: 1 });

    const queried: unknown[] = [];
    harness.ctx.events.on("inventory:queried", (p) => queried.push(p));
    harness.emit("inventory:query", { entity: 1 });

    expect(queried).toEqual([{ entity: 1, items: { potion: 3, sword: 1 } }]);
  });

  it("inventory:query for an entity with nothing held answers with an empty object", () => {
    const queried: unknown[] = [];
    harness.ctx.events.on("inventory:queried", (p) => queried.push(p));
    harness.emit("inventory:query", { entity: 42 });
    expect(queried).toEqual([{ entity: 42, items: {} }]);
  });

  it("reads config.defaultMaxSlots as the capacity for entities with no InventoryCapacity override", () => {
    const configured = makeFakeContext({ defaultMaxSlots: 1 });
    inventoryModule.setup(configured.ctx);
    const entity = configured.ctx.world.create({});

    configured.emit("inventory:add", { entity, itemId: "sword", qty: 1 });
    const rejected: unknown[] = [];
    configured.ctx.events.on("inventory:rejected", (p) => rejected.push(p));
    configured.emit("inventory:add", { entity, itemId: "shield", qty: 1 }); // 2nd distinct stack, over the configured capacity of 1

    expect(rejected).toEqual([{ entity, itemId: "shield", qty: 1, reason: "capacity" }]);
  });
});
