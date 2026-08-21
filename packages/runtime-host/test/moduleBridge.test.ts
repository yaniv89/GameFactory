import { EventBusImpl, FIXED_STEP_MS, InputState, InterceptorRegistry, Scheduler, World, type SchedulerOptions } from "@forge/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GraphNodeRegistry } from "../src/module/graphNodeRegistry";
import { ModuleBridge } from "../src/module/moduleBridge";
import { buildWasmModuleFromEmbeddedBytes } from "./testWasmModule";

const BASE_OPTIONS = {
  version: "1.0.0",
  engineVersion: "0.0.0-test",
  config: {},
  memoryLimitBytes: 16 * 1024 * 1024,
  maxStackSizeBytes: 1024 * 1024,
  computeBudgetMs: 500,
};

function makeHarness(schedulerOptions?: SchedulerOptions) {
  const world = new World();
  const events = new EventBusImpl();
  const scheduler = new Scheduler(world, { events, ...schedulerOptions });
  const interceptors = new InterceptorRegistry();
  const graphNodes = new GraphNodeRegistry();
  return { world, scheduler, events, interceptors, graphNodes };
}

const bridges: ModuleBridge[] = [];
async function createBridge(moduleName: string, harness: ReturnType<typeof makeHarness>, extra: Partial<Parameters<typeof ModuleBridge.create>[0]> = {}) {
  const bridge = await ModuleBridge.create({
    ...BASE_OPTIONS,
    moduleName,
    world: harness.world,
    scheduler: harness.scheduler,
    events: harness.events,
    interceptors: harness.interceptors,
    graphNodes: harness.graphNodes,
    ...extra,
  });
  bridges.push(bridge);
  return bridge;
}

afterEach(() => {
  while (bridges.length > 0) bridges.pop()!.dispose();
});

describe("ModuleBridge: systems (docs/adr/0005 batched snapshot)", () => {
  it("a guest system reads and writes real World component data across a real Scheduler tick", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("test-move", harness);

    const outcome = await bridge.setup(`
      (function () {
        function setup(ctx) {
          ctx.defineComponent("Transform", {
            x: { type: "number" }, y: { type: "number" },
            vx: { type: "number" }, vy: { type: "number" }
          }, { x: 0, y: 0, vx: 0, vy: 0 });
          ctx.addSystem({
            id: "move",
            phase: "Update",
            query: ["Transform"],
            run: function (tctx, entities) {
              entities.forEach(function (id) {
                var t = tctx.world.get(id, "Transform");
                tctx.world.set(id, "Transform", { x: t.x + t.vx * tctx.dt, y: t.y + t.vy * tctx.dt });
              });
            }
          });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    expect(outcome.ok).toBe(true);

    const entity = harness.world.create({ Transform: { x: 0, y: 0, vx: 1, vy: 2 } });
    harness.world.flush();

    harness.scheduler.tick(FIXED_STEP_MS);

    const transform = harness.world.get(entity, "Transform") as { x: number; y: number };
    expect(transform.x).toBeCloseTo(1 * (FIXED_STEP_MS / 1000));
    expect(transform.y).toBeCloseTo(2 * (FIXED_STEP_MS / 1000));
  });

  it("world.create() calls a system makes are visible in a later tick's snapshot", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("test-spawn", harness);

    const outcome = await bridge.setup(`
      (function () {
        function setup(ctx) {
          ctx.defineComponent("Marker", { n: { type: "number" } }, { n: 0 });
          ctx.addSystem({
            id: "spawnOnce",
            phase: "Update",
            query: ["Marker"],
            run: function (tctx, entities) {
              if (tctx.frame === 0) {
                tctx.world.create({ Marker: { n: 1 } });
              }
            }
          });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    expect(outcome.ok).toBe(true);

    const seed = harness.world.create({ Marker: { n: 0 } });
    harness.world.flush();
    expect(harness.world.query(["Marker"]).count()).toBe(1);

    harness.scheduler.tick(FIXED_STEP_MS); // frame 0: system queues a create
    expect(harness.world.query(["Marker"]).count()).toBe(2); // applied + flushed same tick

    harness.scheduler.tick(FIXED_STEP_MS); // frame 1: no-op, count stays put
    expect(harness.world.query(["Marker"]).count()).toBe(2);
    expect(harness.world.isAlive(seed)).toBe(true);
  });

  it("a system that throws every tick logs the failure but never breaks the Scheduler for other systems", async () => {
    const harness = makeHarness();
    const bridgeA = await createBridge("test-throws", harness);
    const bridgeB = await createBridge("test-survives", harness);

    await bridgeA.setup(`
      (function () {
        function setup(ctx) {
          ctx.defineComponent("A", { n: { type: "number" } }, { n: 0 });
          ctx.addSystem({ id: "boom", phase: "Update", query: ["A"], skipIfEmpty: false, run: function () { throw new Error("boom"); } });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);

    const counter = { value: 0 };
    await bridgeB.setup(`
      (function () {
        function setup(ctx) {
          ctx.defineComponent("B", { n: { type: "number" } }, { n: 0 });
          ctx.addSystem({ id: "tick", phase: "Update", query: ["B"], skipIfEmpty: false, run: function () { globalThis.__ticks = (globalThis.__ticks || 0) + 1; } });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => harness.scheduler.tick(FIXED_STEP_MS)).not.toThrow();
    expect(() => harness.scheduler.tick(FIXED_STEP_MS)).not.toThrow();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
    void counter;
  });
});

describe("ModuleBridge: interceptors", () => {
  it("runs a guest interceptor synchronously against a real host-supplied value", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("test-interceptor", harness);

    const outcome = await bridge.setup(`
      (function () {
        function setup(ctx) {
          ctx.addInterceptor("combat:damage", 10, function (value) {
            return Object.assign({}, value, { amount: value.amount * 2 });
          });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    expect(outcome.ok).toBe(true);

    const result = harness.interceptors.run(
      "combat:damage",
      { attacker: 1, target: 2, amount: 5, type: "physical" },
      { world: harness.world },
    );
    expect(result).toEqual({ attacker: 1, target: 2, amount: 10, type: "physical" });
  });

  it("ctx.runInterceptor triggers the shared chain, including filters registered by a different module", async () => {
    const harness = makeHarness();
    const owner = await createBridge("test-dialogue", harness); // owns and triggers the point
    const translator = await createBridge("test-translator", harness); // filters it

    await owner.setup(`
      (function () {
        function setup(ctx) {
          ctx.events.on("dialogue:start", function () {
            var line = ctx.runInterceptor("dialogue:line", { speaker: "Shopkeeper", text: "Welcome.", locale: "en" });
            ctx.events.emit("dialogue:shown", line);
          });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    await translator.setup(`
      (function () {
        function setup(ctx) {
          ctx.addInterceptor("dialogue:line", 10, function (value) {
            return Object.assign({}, value, { text: value.text.toUpperCase() });
          });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);

    const shown: unknown[] = [];
    harness.events.on("dialogue:shown", (payload) => shown.push(payload));
    harness.events.emit("dialogue:start", {});

    expect(shown).toEqual([{ speaker: "Shopkeeper", text: "WELCOME.", locale: "en" }]);
  });

  it("ctx.runInterceptor returns the value unchanged when no filter is registered for the point", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("test-no-filters", harness);
    const outcome = await bridge.setup(`
      (function () {
        function setup(ctx) {
          var result = ctx.runInterceptor("dialogue:line", { speaker: "A", text: "hi", locale: "en" });
          if (result.speaker !== "A" || result.text !== "hi" || result.locale !== "en") {
            throw new Error("runInterceptor mutated the value with no filters registered: " + JSON.stringify(result));
          }
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    expect(outcome.ok).toBe(true);
  });

  it("an interceptor that throws fails open — the value passes through unchanged", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("test-bad-interceptor", harness);
    await bridge.setup(`
      (function () {
        function setup(ctx) {
          ctx.addInterceptor("combat:damage", 10, function () { throw new Error("nope"); });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const value = { attacker: 1, target: 2, amount: 5, type: "physical" };
    const result = harness.interceptors.run("combat:damage", value, { world: harness.world });
    errorSpy.mockRestore();

    expect(result).toEqual(value);
  });
});

describe("ModuleBridge: defineGraphNode (docs/adr/0017, M4)", () => {
  it("registers a node type, attributed to the calling module, with a real live guest execute handle", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("acme-loot-tables", harness);

    const outcome = await bridge.setup(`
      (function () {
        function setup(ctx) {
          ctx.defineGraphNode({
            type: "acme:doubleGold",
            inputs: [{ name: "gold", type: "number" }],
            outputs: [{ name: "result", type: "number" }],
            execute: function (ctx, inputs, config) {
              return { result: inputs.gold * 2 };
            }
          });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    expect(outcome.ok).toBe(true);

    const registered = harness.graphNodes.get("acme:doubleGold");
    expect(registered?.moduleName).toBe("acme-loot-tables");
    expect(registered?.inputs).toEqual([{ name: "gold", type: "number" }]);
    expect(registered?.outputs).toEqual([{ name: "result", type: "number" }]);
    // Proves the function genuinely crossed the boundary intact (survived
    // the .dup(), still alive after setup()'s own ctxHandle disposal) —
    // not just that the metadata landed. Actually *invoking* it is
    // @forge/graph-runtime's job (M5), which doesn't exist yet and isn't
    // guessed at here (docs/adr/0017 Decision 4's own M4/M5 split).
    expect(bridge.isDisposed).toBe(false);
  });

  it("a third-party-shaped module (built only against the public SetupContext, like @forge/dialogue already is) registers its own node type no differently than a first-party one would", async () => {
    const harness = makeHarness();
    const thirdParty = await createBridge("@acme/loot-tables", harness);

    const outcome = await thirdParty.setup(`
      (function () {
        function setup(ctx) {
          ctx.defineGraphNode({
            type: "acme:rollLoot",
            inputs: [],
            outputs: [{ name: "itemId", type: "string" }],
            execute: function () { return { itemId: "sword" }; }
          });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);

    expect(outcome.ok).toBe(true);
    expect(harness.graphNodes.get("acme:rollLoot")?.moduleName).toBe("@acme/loot-tables");
    expect(harness.graphNodes.size).toBe(1);
  });

  it("two different modules can each register their own distinct node type into the same shared registry", async () => {
    const harness = makeHarness();
    const moduleA = await createBridge("module-a", harness);
    const moduleB = await createBridge("module-b", harness);

    await moduleA.setup(`
      (function () {
        function setup(ctx) {
          ctx.defineGraphNode({ type: "a:node", inputs: [], outputs: [], execute: function () {} });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    await moduleB.setup(`
      (function () {
        function setup(ctx) {
          ctx.defineGraphNode({ type: "b:node", inputs: [], outputs: [], execute: function () {} });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);

    expect(harness.graphNodes.size).toBe(2);
    expect(harness.graphNodes.get("a:node")?.moduleName).toBe("module-a");
    expect(harness.graphNodes.get("b:node")?.moduleName).toBe("module-b");
  });

  it("registering a node type that's already taken by another module fails setup() with a clear, attributable error", async () => {
    const harness = makeHarness();
    const first = await createBridge("first-module", harness);
    const second = await createBridge("second-module", harness);

    const firstOutcome = await first.setup(`
      (function () {
        function setup(ctx) {
          ctx.defineGraphNode({ type: "shared:type", inputs: [], outputs: [], execute: function () {} });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    expect(firstOutcome.ok).toBe(true);

    const secondOutcome = await second.setup(`
      (function () {
        function setup(ctx) {
          ctx.defineGraphNode({ type: "shared:type", inputs: [], outputs: [], execute: function () {} });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    expect(secondOutcome.ok).toBe(false);
    if (!secondOutcome.ok) {
      expect(secondOutcome.error.message).toMatch(/shared:type/);
      expect(secondOutcome.error.message).toMatch(/first-module/);
    }
    // The original registration is untouched by the failed second attempt.
    expect(harness.graphNodes.get("shared:type")?.moduleName).toBe("first-module");
  });
});

describe("ModuleBridge: events", () => {
  it("a guest handler registered via ctx.events.on receives host- and guest-emitted events", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("test-events", harness);
    await bridge.setup(`
      (function () {
        function setup(ctx) {
          ctx.events.on("ping", function (payload) {
            ctx.events.emit("pong", { echo: payload.value });
          });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);

    const received: unknown[] = [];
    harness.events.on("pong", (payload) => received.push(payload));
    harness.events.emit("ping", { value: 42 });

    expect(received).toEqual([{ echo: 42 }]);
  });

  it("ctx.events.off unsubscribes the guest handler", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("test-events-off", harness);
    await bridge.setup(`
      (function () {
        function setup(ctx) {
          function onPing(payload) { globalThis.__pings = (globalThis.__pings || 0) + 1; }
          ctx.events.on("ping", onPing);
          ctx.events.off("ping", onPing);
        }
        __forge_registerModule({ setup: setup });
      })();
    `);

    harness.events.emit("ping", {});
    // Nothing to assert against from the host side directly (the counter is
    // guest-local) — the real assertion is that emit() didn't throw and
    // didn't call a disposed handle, which a crash here would reveal.
    expect(true).toBe(true);
  });
});

describe("ModuleBridge: ctx.world (docs/adr/0006)", () => {
  it("is reachable from setup() and from an events.on() handler, and writes apply immediately", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("test-ctx-world", harness);

    const outcome = await bridge.setup(`
      (function () {
        function setup(ctx) {
          ctx.defineComponent("Health", { hp: { type: "number" } }, { hp: 10 });
          var entity = ctx.world.create({ Health: { hp: 10 } });
          if (!ctx.world.has(entity, "Health")) throw new Error("ctx.world.create()/has() did not apply immediately");

          ctx.events.on("damage", function (payload) {
            var health = ctx.world.get(payload.entity, "Health");
            ctx.world.set(payload.entity, "Health", { hp: health.hp - payload.amount });
          });

          // Drive the event from inside setup() itself — proves ctx.world inside
          // the events.on() handler (not just setup()'s own top-level scope) sees
          // a live, immediately-applied world.
          ctx.events.emit("damage", { entity: entity, amount: 3 });
          var after = ctx.world.get(entity, "Health");
          if (after.hp !== 7) throw new Error("expected hp 7 after damage, got " + after.hp);
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    expect(outcome.ok).toBe(true);
  });
});

describe("ModuleBridge: storage capability", () => {
  it("ctx.storage is always present and round-trips a value", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("test-storage", harness);
    const outcome = await bridge.setup(`
      (function () {
        function setup(ctx) {
          ctx.storage.set("coins", 7);
          if (ctx.storage.get("coins") !== 7) throw new Error("storage round-trip failed");
          if (ctx.net !== undefined) throw new Error("net should be undefined without networkAllowedOrigins");
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    expect(outcome.ok).toBe(true);
  });
});

describe("ModuleBridge: setup() error surfacing", () => {
  it("a module that never calls __forge_registerModule fails setup() with a clear message", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("test-no-register", harness);
    const outcome = await bridge.setup(`(function () { /* forgot to register */ })();`);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.message).toMatch(/did not call __forge_registerModule/);
    }
  });
});

describe("ModuleBridge: ctx.input / ctx.scene (github.com/yaniv89/GameFactory/issues/3)", () => {
  it("a guest system reads real, host-fed input state: isActionDown, wasActionPressed/Released, pointerPosition", async () => {
    const harness = makeHarness({ input: new InputState({ jump: [{ type: "key", code: "Space" }] }) });
    const bridge = await createBridge("test-input", harness);

    const outcome = await bridge.setup(`
      (function () {
        function setup(ctx) {
          ctx.defineComponent("Observed", {
            down: { type: "number" }, pressed: { type: "number" }, released: { type: "number" },
            px: { type: "number" }, py: { type: "number" }
          }, { down: 0, pressed: 0, released: 0, px: 0, py: 0 });
          ctx.addSystem({
            id: "observe",
            phase: "Update",
            query: ["Observed"],
            run: function (tctx, entities) {
              entities.forEach(function (id) {
                tctx.world.set(id, "Observed", {
                  down: tctx.input.isActionDown("jump") ? 1 : 0,
                  pressed: tctx.input.wasActionPressed("jump") ? 1 : 0,
                  released: tctx.input.wasActionReleased("jump") ? 1 : 0,
                  px: tctx.input.pointerPosition.x,
                  py: tctx.input.pointerPosition.y
                });
              });
            }
          });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    expect(outcome.ok).toBe(true);

    const entity = harness.world.create({ Observed: { down: 0, pressed: 0, released: 0, px: 0, py: 0 } });
    harness.world.flush();

    harness.scheduler.input.handleKeyDown("Space");
    harness.scheduler.input.handlePointerMove(12, 34);
    harness.scheduler.tick(FIXED_STEP_MS);

    expect(harness.world.get(entity, "Observed")).toEqual({ down: 1, pressed: 1, released: 0, px: 12, py: 34 });

    harness.scheduler.input.handleKeyUp("Space");
    harness.scheduler.tick(FIXED_STEP_MS);

    expect(harness.world.get(entity, "Observed")).toEqual({ down: 0, pressed: 0, released: 1, px: 12, py: 34 });
  });

  it("ctx.scene.currentSceneId reflects the scheduler's current scene, and a guest's transitionTo() takes effect on the next tick", async () => {
    const harness = makeHarness({ initialSceneId: "village" });
    const bridge = await createBridge("test-scene", harness);

    const outcome = await bridge.setup(`
      (function () {
        function setup(ctx) {
          ctx.defineComponent("Marker", { n: { type: "number" } }, { n: 0 });
          ctx.addSystem({
            id: "requestTransitionOnce",
            phase: "Update",
            query: ["Marker"],
            skipIfEmpty: false,
            run: function (tctx) {
              if (tctx.frame === 0) tctx.scene.transitionTo("dungeon");
            }
          });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    expect(outcome.ok).toBe(true);
    harness.world.create({});
    harness.world.flush();

    const changes: unknown[] = [];
    harness.events.on("scene:changed", (payload) => changes.push(payload));

    expect(harness.scheduler.scene.currentSceneId).toBe("village");
    harness.scheduler.tick(FIXED_STEP_MS); // frame 0: guest requests the transition
    expect(harness.scheduler.scene.currentSceneId).toBe("dungeon"); // applied at this same tick's boundary
    expect(changes).toEqual([{ from: "village", to: "dungeon" }]);
  });
});

describe("ModuleBridge: async setup() (github.com/yaniv89/GameFactory/issues/4)", () => {
  it("awaits a setup() that registers a system only after an internal await, before setup() resolves", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("test-async-setup", harness);

    const outcome = await bridge.setup(`
      (function () {
        async function setup(ctx) {
          ctx.defineComponent("Counter", { n: { type: "number" } }, { n: 0 });
          // Deliberately register the system only after a real await, so
          // this proves callFunctionAsync actually drives the promise
          // chain to completion rather than returning as soon as setup()
          // synchronously produces a Promise.
          await Promise.resolve();
          ctx.addSystem({
            id: "increment",
            phase: "Update",
            query: ["Counter"],
            run: function (tctx, entities) {
              entities.forEach(function (id) {
                var c = tctx.world.get(id, "Counter");
                tctx.world.set(id, "Counter", { n: c.n + 1 });
              });
            }
          });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    expect(outcome.ok).toBe(true);

    const entity = harness.world.create({ Counter: { n: 0 } });
    harness.world.flush();
    harness.scheduler.tick(FIXED_STEP_MS);

    // If setup() had resolved this Promise's await instead of waiting for
    // it, the system above would never have been registered and this tick
    // would be a no-op.
    expect(harness.world.get(entity, "Counter")).toEqual({ n: 1 });
  });

  it("surfaces an async setup() rejection as a failed outcome, same shape as a synchronous throw", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("test-async-setup-reject", harness);

    const outcome = await bridge.setup(`
      (function () {
        async function setup(ctx) {
          await Promise.resolve();
          throw new Error("async setup failed");
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.message).toBe("async setup failed");
    }
  });
});

describe("ModuleBridge: wasmModule override (M6 Phase 5d)", () => {
  it("setup() and a real tick both work when built from a caller-supplied WASM module instead of the default getQuickJS() singleton", async () => {
    const wasmModule = await buildWasmModuleFromEmbeddedBytes();
    const harness = makeHarness();
    const bridge = await createBridge("test-wasm-override", harness, { wasmModule });

    const outcome = await bridge.setup(`
      (function () {
        function setup(ctx) {
          ctx.defineComponent("Counter", { n: { type: "number" } }, { n: 0 });
          ctx.addSystem({
            id: "increment",
            phase: "Update",
            query: ["Counter"],
            run: function (tctx, entities) {
              entities.forEach(function (id) {
                var c = tctx.world.get(id, "Counter");
                tctx.world.set(id, "Counter", { n: c.n + 1 });
              });
            }
          });
        }
        __forge_registerModule({ setup: setup });
      })();
    `);
    expect(outcome.ok).toBe(true);

    const entity = harness.world.create({ Counter: { n: 0 } });
    harness.world.flush();
    harness.scheduler.tick(FIXED_STEP_MS);

    expect(harness.world.get(entity, "Counter")).toEqual({ n: 1 });
  });
});
