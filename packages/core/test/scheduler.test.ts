import { describe, expect, it } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { World } from "../src/ecs/world";
import { FIXED_STEP_MS } from "../src/scheduler/phase";
import { Scheduler } from "../src/scheduler/scheduler";
import type { SystemDefinition } from "../src/scheduler/system";
import { resolveSystemOrder } from "../src/scheduler/system";

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

function stubSystem(overrides: Partial<SystemDefinition> & Pick<SystemDefinition, "id" | "phase">): SystemDefinition {
  return {
    query: [],
    run: () => {},
    ...overrides,
  };
}

describe("resolveSystemOrder", () => {
  it("orders systems by before/after regardless of registration order", () => {
    const c = stubSystem({ id: "c", phase: "Update", after: ["b"] });
    const b = stubSystem({ id: "b", phase: "Update", after: ["a"] });
    const a = stubSystem({ id: "a", phase: "Update" });
    const order = resolveSystemOrder([c, b, a]);
    expect(order.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("honors `before` the same as an equivalent `after`", () => {
    const a = stubSystem({ id: "a", phase: "Update", before: ["b"] });
    const b = stubSystem({ id: "b", phase: "Update" });
    const order = resolveSystemOrder([b, a]);
    expect(order.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("breaks ties deterministically by id when there is no ordering constraint", () => {
    const z = stubSystem({ id: "z", phase: "Update" });
    const m = stubSystem({ id: "m", phase: "Update" });
    const a = stubSystem({ id: "a", phase: "Update" });
    expect(resolveSystemOrder([z, m, a]).map((s) => s.id)).toEqual(["a", "m", "z"]);
  });

  it("throws a hard error on a dependency cycle, naming the systems involved", () => {
    const a = stubSystem({ id: "a", phase: "Update", after: ["b"] });
    const b = stubSystem({ id: "b", phase: "Update", after: ["a"] });
    expect(() => resolveSystemOrder([a, b])).toThrow(/cycle/i);
  });
});

describe("Scheduler: phase ordering across a full tick", () => {
  it("runs phases in PreUpdate -> Update -> PostUpdate -> Physics -> PreRender -> Render -> UI order", () => {
    const world = makeWorld();
    const scheduler = new Scheduler(world);
    const seen: string[] = [];

    for (const phase of ["PreUpdate", "Update", "PostUpdate", "Physics", "PreRender", "Render", "UI"] as const) {
      scheduler.addSystem(
        stubSystem({
          id: `record:${phase}`,
          phase,
          skipIfEmpty: false,
          run: () => seen.push(phase),
        }),
      );
    }

    scheduler.tick(FIXED_STEP_MS);

    expect(seen).toEqual(["PreUpdate", "Update", "PostUpdate", "Physics", "PreRender", "Render", "UI"]);
  });

  it("rejects registering the same system id twice, even across phases", () => {
    const scheduler = new Scheduler(makeWorld());
    scheduler.addSystem(stubSystem({ id: "dup", phase: "Update" }));
    expect(() => scheduler.addSystem(stubSystem({ id: "dup", phase: "Physics" }))).toThrow();
  });
});

describe("Scheduler: fixed-step accumulator", () => {
  it("runs exactly one fixed step per FIXED_STEP_MS of elapsed time", () => {
    const scheduler = new Scheduler(makeWorld());
    let fixedStepCalls = 0;
    scheduler.addSystem(
      stubSystem({ id: "counter", phase: "Update", skipIfEmpty: false, run: () => fixedStepCalls++ }),
    );

    scheduler.tick(FIXED_STEP_MS * 3);

    expect(fixedStepCalls).toBe(3);
    expect(scheduler.fixedStepCount).toBe(3);
  });

  it("carries a leftover fractional step across calls to tick()", () => {
    const scheduler = new Scheduler(makeWorld());
    let fixedStepCalls = 0;
    scheduler.addSystem(
      stubSystem({ id: "counter", phase: "Update", skipIfEmpty: false, run: () => fixedStepCalls++ }),
    );

    scheduler.tick(FIXED_STEP_MS * 1.5);
    expect(fixedStepCalls).toBe(1);

    scheduler.tick(FIXED_STEP_MS * 0.5);
    expect(fixedStepCalls).toBe(2);
  });

  it("clamps a huge dt to MAX_ACCUMULATED_MS instead of running thousands of steps", () => {
    const scheduler = new Scheduler(makeWorld());
    let fixedStepCalls = 0;
    scheduler.addSystem(
      stubSystem({ id: "counter", phase: "Update", skipIfEmpty: false, run: () => fixedStepCalls++ }),
    );

    scheduler.tick(60_000);

    // 250ms of accumulator at a 60Hz fixed step is exactly 15 steps
    // (250 * 60 / 1000). Deliberately not expressed as
    // Math.floor(MAX_ACCUMULATED_MS / FIXED_STEP_MS) here: that expression
    // hits the same float64 rounding FIXED_STEP_MS (1000/60, not exactly
    // representable) that the scheduler's epsilon tolerance exists to
    // absorb, and evaluates to 14 rather than 15.
    expect(fixedStepCalls).toBe(15);
  });

  it("runs the per-frame phases exactly once per tick() call regardless of how many fixed steps ran", () => {
    const scheduler = new Scheduler(makeWorld());
    let renderCalls = 0;
    scheduler.addSystem(
      stubSystem({ id: "render", phase: "Render", skipIfEmpty: false, run: () => renderCalls++ }),
    );

    scheduler.tick(FIXED_STEP_MS * 4);

    expect(renderCalls).toBe(1);
  });

  it("computes alpha as the leftover accumulator fraction", () => {
    const scheduler = new Scheduler(makeWorld());
    let observedAlpha = -1;
    scheduler.addSystem(
      stubSystem({
        id: "render",
        phase: "Render",
        skipIfEmpty: false,
        run: (ctx) => {
          observedAlpha = ctx.alpha;
        },
      }),
    );

    scheduler.tick(FIXED_STEP_MS * 1.25);

    expect(observedAlpha).toBeCloseTo(0.25, 5);
  });
});

describe("Scheduler: query integration", () => {
  it("skips a system by default when its query matches no entities", () => {
    const world = makeWorld();
    const scheduler = new Scheduler(world);
    let calls = 0;
    scheduler.addSystem(
      stubSystem({ id: "movers", phase: "Update", query: ["Transform", "Velocity"], run: () => calls++ }),
    );

    scheduler.tick(FIXED_STEP_MS);
    expect(calls).toBe(0);
  });

  it("runs a system once entities matching its query exist", () => {
    const world = makeWorld();
    world.create({ Transform: { x: 0, y: 0 }, Velocity: { vx: 1, vy: 0 } });
    world.flush();

    const scheduler = new Scheduler(world);
    let calls = 0;
    scheduler.addSystem(
      stubSystem({ id: "movers", phase: "Update", query: ["Transform", "Velocity"], run: () => calls++ }),
    );

    scheduler.tick(FIXED_STEP_MS);
    expect(calls).toBe(1);
  });

  it("forces a run with skipIfEmpty: false even when the query matches nothing", () => {
    const world = makeWorld();
    const scheduler = new Scheduler(world);
    let calls = 0;
    scheduler.addSystem(
      stubSystem({
        id: "always",
        phase: "Update",
        query: ["Transform"],
        skipIfEmpty: false,
        run: () => calls++,
      }),
    );

    scheduler.tick(FIXED_STEP_MS);
    expect(calls).toBe(1);
  });

  it("makes an entity created in an earlier phase visible to a later phase's query in the same fixed step", () => {
    const world = makeWorld();
    const scheduler = new Scheduler(world);
    let sawItInUpdate = false;

    scheduler.addSystem(
      stubSystem({
        id: "spawner",
        phase: "PreUpdate",
        skipIfEmpty: false,
        run: (ctx) => {
          ctx.world.create({ Transform: { x: 0, y: 0 } });
        },
      }),
    );
    scheduler.addSystem(
      stubSystem({
        id: "observer",
        phase: "Update",
        query: ["Transform"],
        run: () => {
          sawItInUpdate = true;
        },
      }),
    );

    scheduler.tick(FIXED_STEP_MS);
    expect(sawItInUpdate).toBe(true);
  });
});
