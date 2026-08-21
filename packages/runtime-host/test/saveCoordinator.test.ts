import { EventBusImpl, InterceptorRegistry, Scheduler, World } from "@forge/core";
import { afterEach, describe, expect, it } from "vitest";
import { GraphNodeRegistry } from "../src/module/graphNodeRegistry";
import { ModuleBridge } from "../src/module/moduleBridge";
import { createSave, loadSave } from "../src/save/saveCoordinator";

const BASE_OPTIONS = {
  engineVersion: "0.0.0-test",
  config: {},
  memoryLimitBytes: 16 * 1024 * 1024,
  maxStackSizeBytes: 1024 * 1024,
  computeBudgetMs: 500,
};

function makeHarness() {
  const world = new World();
  const scheduler = new Scheduler(world);
  const events = new EventBusImpl();
  const interceptors = new InterceptorRegistry();
  const graphNodes = new GraphNodeRegistry();
  return { world, scheduler, events, interceptors, graphNodes };
}

const bridges: ModuleBridge[] = [];
async function createBridge(moduleName: string, version: string, harness: ReturnType<typeof makeHarness>) {
  const bridge = await ModuleBridge.create({
    ...BASE_OPTIONS,
    moduleName,
    version,
    world: harness.world,
    scheduler: harness.scheduler,
    events: harness.events,
    interceptors: harness.interceptors,
    graphNodes: harness.graphNodes,
  });
  bridges.push(bridge);
  return bridge;
}

async function setupInventoryModule(bridge: ModuleBridge, initialGold?: number) {
  const outcome = await bridge.setup(`
    (function () {
      function setup(ctx) {
        ctx.defineComponent("Held", { qty: { type: "number" } }, { qty: 0 });
        ${initialGold === undefined ? "" : `ctx.storage.set("gold", ${initialGold});`}
      }
      __forge_registerModule({ setup: setup });
    })();
  `);
  expect(outcome.ok).toBe(true);
}

afterEach(() => {
  while (bridges.length > 0) bridges.pop()!.dispose();
});

describe("saveCoordinator: createSave / loadSave", () => {
  it("round-trips world entities and a module's storage:local state", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("@test/inventory", "1.0.0", harness);
    await setupInventoryModule(bridge, 42);

    const entity = harness.world.create({ Held: { qty: 3 } });
    harness.world.flush();

    const save = createSave({
      world: harness.world,
      modules: [bridge],
      schemaVersion: 1,
      engineVersion: "0.0.0-test",
      projectId: "proj-1",
      buildId: "build-1",
      playtimeSec: 120,
      flags: {},
      currentScene: "overworld",
    });

    expect(save.moduleVersions).toEqual({ "@test/inventory": "1.0.0" });
    expect(save.globals).toEqual({ "@test/inventory": { gold: 42 } });
    expect(save.world.entities).toHaveLength(1);

    const targetHarness = makeHarness();
    const targetBridge = await createBridge("@test/inventory", "1.0.0", targetHarness);
    // Deliberately does NOT call storage.set("gold", ...) — the only way "gold: 42"
    // can end up in this bridge's storage is via loadSave() actually restoring it.
    await setupInventoryModule(targetBridge);
    expect(targetBridge.snapshotStorage()).toEqual({});

    const result = loadSave(targetHarness.world, [targetBridge], save);
    expect(result.orphaned).toEqual({});
    expect(targetHarness.world.isAlive(entity)).toBe(true);
    expect(targetHarness.world.get(entity, "Held")).toMatchObject({ qty: 3 });
    expect(targetBridge.snapshotStorage()).toEqual({ gold: 42 });
  });

  it("a module not installed at load time is preserved verbatim in the returned orphaned map", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("@test/weather", "1.0.0", harness);
    await bridge.setup(`
      (function () {
        function setup(ctx) { ctx.storage.set("season", "winter"); }
        __forge_registerModule({ setup: setup });
      })();
    `);

    const save = createSave({
      world: harness.world,
      modules: [bridge],
      schemaVersion: 1,
      engineVersion: "0.0.0-test",
      projectId: "proj-1",
      buildId: "build-1",
      playtimeSec: 0,
      flags: {},
      currentScene: "overworld",
    });

    const targetHarness = makeHarness();
    const result = loadSave(targetHarness.world, [], save); // module not installed this time
    expect(result.orphaned).toEqual({ "@test/weather": { version: "1.0.0", globals: { season: "winter" } } });

    // Saving again without reinstalling must carry the orphaned data forward.
    const secondSave = createSave({
      world: targetHarness.world,
      modules: [],
      schemaVersion: 1,
      engineVersion: "0.0.0-test",
      projectId: "proj-1",
      buildId: "build-2",
      playtimeSec: 5,
      flags: {},
      currentScene: "overworld",
      orphaned: result.orphaned,
    });
    expect(secondSave._orphaned).toEqual({ "@test/weather": { version: "1.0.0", globals: { season: "winter" } } });
    expect(secondSave.moduleVersions).toEqual({});
  });

  it("reinstalling a previously-orphaned module restores its globals on the next load", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("@test/weather", "1.0.0", harness);
    await bridge.setup(`
      (function () {
        function setup(ctx) { ctx.storage.set("season", "winter"); }
        __forge_registerModule({ setup: setup });
      })();
    `);
    const save = createSave({
      world: harness.world,
      modules: [bridge],
      schemaVersion: 1,
      engineVersion: "0.0.0-test",
      projectId: "proj-1",
      buildId: "build-1",
      playtimeSec: 0,
      flags: {},
      currentScene: "overworld",
    });

    const midHarness = makeHarness();
    const { orphaned } = loadSave(midHarness.world, [], save); // uninstalled

    const orphanedSave = createSave({
      world: midHarness.world,
      modules: [],
      schemaVersion: 1,
      engineVersion: "0.0.0-test",
      projectId: "proj-1",
      buildId: "build-2",
      playtimeSec: 0,
      flags: {},
      currentScene: "overworld",
      orphaned,
    });

    const finalHarness = makeHarness();
    const reinstalled = await createBridge("@test/weather", "1.0.0", finalHarness);
    const finalResult = loadSave(finalHarness.world, [reinstalled], orphanedSave); // reinstalled
    expect(finalResult.orphaned).toEqual({});
    expect(reinstalled.snapshotStorage()).toEqual({ season: "winter" });
  });

  it("refuses to load a save whose module major version is newer than the installed module", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("@test/weather", "2.0.0", harness);
    await bridge.setup(`(function(){ function setup(ctx){ ctx.storage.set("x", 1); } __forge_registerModule({ setup: setup }); })();`);
    const save = createSave({
      world: harness.world,
      modules: [bridge],
      schemaVersion: 1,
      engineVersion: "0.0.0-test",
      projectId: "p",
      buildId: "b",
      playtimeSec: 0,
      flags: {},
      currentScene: "s",
    });

    const targetHarness = makeHarness();
    const olderBridge = await createBridge("@test/weather", "1.0.0", targetHarness); // installed is OLDER than the save
    expect(() => loadSave(targetHarness.world, [olderBridge], save)).toThrow(/newer than the installed/);
  });

  it("invokes migrateSave when the installed module's major version is ahead of the save, and refuses when migrateSave is missing", async () => {
    const harness = makeHarness();
    const bridge = await createBridge("@test/inventory", "1.0.0", harness);
    await bridge.setup(`(function(){ function setup(ctx){ ctx.storage.set("gold", 10); } __forge_registerModule({ setup: setup }); })();`);
    const save = createSave({
      world: harness.world,
      modules: [bridge],
      schemaVersion: 1,
      engineVersion: "0.0.0-test",
      projectId: "p",
      buildId: "b",
      playtimeSec: 0,
      flags: {},
      currentScene: "s",
    });

    // Installed module is now major version 2, WITH a migrateSave: migration runs and its result is what gets restored.
    const migratedHarness = makeHarness();
    const migratingBridge = await createBridge("@test/inventory", "2.0.0", migratedHarness);
    await migratingBridge.setup(`
      (function () {
        function setup(ctx) {}
        function migrateSave(from, to, data) {
          return Object.assign({}, data, { gold: data.gold * 10, migrated: true });
        }
        __forge_registerModule({ setup: setup, migrateSave: migrateSave });
      })();
    `);
    loadSave(migratedHarness.world, [migratingBridge], save);
    expect(migratingBridge.snapshotStorage()).toEqual({ gold: 100, migrated: true });

    // Installed module is major version 2 with NO migrateSave: must refuse rather than silently drop the mismatch.
    const noMigrationHarness = makeHarness();
    const noMigrationBridge = await createBridge("@test/inventory", "2.0.0", noMigrationHarness);
    await noMigrationBridge.setup(`(function(){ function setup(ctx){} __forge_registerModule({ setup: setup }); })();`);
    expect(() => loadSave(noMigrationHarness.world, [noMigrationBridge], save)).toThrow(/declares no migrateSave/);
  });

  it("rejects a save with a duplicate entity id before touching the World", async () => {
    const harness = makeHarness();
    const corruptSave = {
      schemaVersion: 1,
      engineVersion: "0.0.0-test",
      projectId: "p",
      buildId: "b",
      createdAt: new Date().toISOString(),
      playtimeSec: 0,
      moduleVersions: {},
      world: { entities: [{ id: 1, components: {} }, { id: 1, components: {} }], nextEntityId: 2 },
      globals: {},
      flags: {},
      currentScene: "s",
      _orphaned: {},
    };
    expect(() => loadSave(harness.world, [], corruptSave)).toThrow(/duplicate entity id/);
  });
});
