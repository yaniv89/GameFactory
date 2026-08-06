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
import { turnBattleModule } from "../src/index";
import { COMBATANT_COMPONENT, type CombatantShape } from "../src/types";

/** Same fake-SetupContext shape as the dialogue/inventory module test suites. */
function makeFakeContext() {
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
    config: {},
    engineVersion: "0.0.0-test",
    moduleName: "@test/turn-battle",
    world,
    defineComponent<T extends ComponentShape>(name: string, _schema: ComponentJsonSchema, _defaults: T): ComponentHandle<T> {
      return { name };
    },
    addSystem() {
      throw new Error("@forge/turn-battle does not register systems");
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
    storage,
    log: logger,
  };

  return { ctx, worldData, logs, storageData, emit: ctx.events.emit.bind(ctx.events) };
}

function makeCombatant(harness: ReturnType<typeof makeFakeContext>, stats: Partial<CombatantShape>): EntityId {
  return harness.ctx.world.create({
    [COMBATANT_COMPONENT]: { hp: 10, maxHp: 10, atk: 3, def: 0, alive: true, ...stats },
  });
}

/** Forces every attack to hit or miss deterministically, since the module rolls Math.random() itself against the interceptor-supplied chance. */
function forceHitChance(harness: ReturnType<typeof makeFakeContext>, chance: 0 | 1): void {
  harness.ctx.addInterceptor("combat:hitChance", 0, (value) => ({ ...value, chance }));
}

describe("@forge/turn-battle", () => {
  let harness: ReturnType<typeof makeFakeContext>;

  beforeEach(() => {
    harness = makeFakeContext();
    turnBattleModule.setup(harness.ctx);
  });

  it("battle:start requires both entities to carry Combatant", () => {
    const a = makeCombatant(harness, {});
    harness.emit("battle:start", { a, b: 999 });
    expect(harness.logs.some((l) => l.level === "error" && l.message.includes("requires both entities to carry Combatant"))).toBe(
      true,
    );
  });

  it("battle:start sets the first entity's turn and emits battle:turnStarted", () => {
    const a = makeCombatant(harness, {});
    const b = makeCombatant(harness, {});
    const started: unknown[] = [];
    harness.ctx.events.on("battle:turnStarted", (p) => started.push(p));

    harness.emit("battle:start", { a, b });
    expect(started).toEqual([{ entity: a }]);
  });

  it("battle:attack out of turn is rejected", () => {
    const a = makeCombatant(harness, {});
    const b = makeCombatant(harness, {});
    harness.emit("battle:start", { a, b });
    harness.emit("battle:attack", { attacker: b }); // it's a's turn
    expect(harness.logs.some((l) => l.level === "warn" && l.message.includes("out of turn"))).toBe(true);
  });

  it("a forced hit applies damage through combat:damage, and turn passes to the target", () => {
    const a = makeCombatant(harness, { atk: 4 });
    const b = makeCombatant(harness, { def: 1 });
    forceHitChance(harness, 1);
    const damageEvents: unknown[] = [];
    const turnEvents: unknown[] = [];
    harness.ctx.events.on("battle:damageApplied", (p) => damageEvents.push(p));
    harness.ctx.events.on("battle:turnStarted", (p) => turnEvents.push(p));

    harness.emit("battle:start", { a, b });
    harness.emit("battle:attack", { attacker: a });

    expect(damageEvents).toEqual([{ attacker: a, target: b, amount: 3, remainingHp: 7 }]); // 4 atk - 1 def
    expect(turnEvents).toEqual([{ entity: a }, { entity: b }]);
    expect(harness.worldData.get(b)![COMBATANT_COMPONENT]).toMatchObject({ hp: 7, alive: true });
  });

  it("a forced miss emits battle:missed and still passes the turn, without applying damage", () => {
    const a = makeCombatant(harness, {});
    const b = makeCombatant(harness, {});
    forceHitChance(harness, 0);
    const missed: unknown[] = [];
    const damage: unknown[] = [];
    harness.ctx.events.on("battle:missed", (p) => missed.push(p));
    harness.ctx.events.on("battle:damageApplied", (p) => damage.push(p));

    harness.emit("battle:start", { a, b });
    harness.emit("battle:attack", { attacker: a });

    expect(missed).toEqual([{ attacker: a, target: b }]);
    expect(damage).toEqual([]);
    expect(harness.worldData.get(b)![COMBATANT_COMPONENT]).toMatchObject({ hp: 10 });
  });

  it("a hit that brings the target to 0 hp ends the battle and declares the attacker the winner", () => {
    const a = makeCombatant(harness, { atk: 20 });
    const b = makeCombatant(harness, { hp: 5, def: 0 });
    forceHitChance(harness, 1);
    const defeated: unknown[] = [];
    const ended: unknown[] = [];
    harness.ctx.events.on("battle:defeated", (p) => defeated.push(p));
    harness.ctx.events.on("battle:ended", (p) => ended.push(p));

    harness.emit("battle:start", { a, b });
    harness.emit("battle:attack", { attacker: a });

    expect(defeated).toEqual([{ entity: b }]);
    expect(ended).toEqual([{ winner: a, loser: b }]);
    expect(harness.worldData.get(b)![COMBATANT_COMPONENT]).toMatchObject({ hp: 0, alive: false });
    expect(harness.storageData.get("battle:active")).toBeUndefined();
  });

  it("a third-party module can raise hit chance and boost damage via the same interceptor points", () => {
    const a = makeCombatant(harness, { atk: 5 });
    const b = makeCombatant(harness, { def: 0, hp: 100 });
    harness.ctx.addInterceptor("combat:hitChance", 0, (value) => ({ ...value, chance: 1 }));
    harness.ctx.addInterceptor("combat:damage", 0, (value) => ({ ...value, amount: value.amount * 2 })); // a "double damage" buff module

    const damage: unknown[] = [];
    harness.ctx.events.on("battle:damageApplied", (p) => damage.push(p));
    harness.emit("battle:start", { a, b });
    harness.emit("battle:attack", { attacker: a });

    expect(damage).toEqual([{ attacker: a, target: b, amount: 10, remainingHp: 90 }]); // 5 atk doubled
  });

  it("battle:attack with no active battle logs a warning instead of throwing", () => {
    expect(() => harness.emit("battle:attack", { attacker: 1 })).not.toThrow();
    expect(harness.logs.some((l) => l.level === "warn" && l.message.includes("no active battle"))).toBe(true);
  });
});
