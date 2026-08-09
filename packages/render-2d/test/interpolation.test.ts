import { registerCoreComponents, World } from "@forge/core";
import { describe, expect, it } from "vitest";
import { createTransformSnapshotSystem, lerp, TransformSnapshotStore } from "../src/interpolation";

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

describe("lerp", () => {
  it("returns a at t=0 and b at t=1", () => {
    expect(lerp(10, 20, 0)).toBe(10);
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it("blends proportionally in between", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});

describe("TransformSnapshotStore / createTransformSnapshotSystem", () => {
  it("captures each entity's Transform the first time the system runs", () => {
    const world = makeWorld();
    const entity = world.create({ Transform: { x: 3, y: 4, rotation: 0 } });
    world.flush();

    const store = new TransformSnapshotStore();
    const system = createTransformSnapshotSystem(world, store);
    system.run({ dt: 1 / 60, alpha: 0, elapsed: 0, frame: 0, world }, world.query(["Transform"]));

    expect(store.get(entity)).toEqual({ x: 3, y: 4, rotation: 0 });
  });

  it("keeps the pre-step snapshot even after a later system moves the entity in the same step", () => {
    const world = makeWorld();
    const entity = world.create({ Transform: { x: 0, y: 0, rotation: 0 } });
    world.flush();

    const store = new TransformSnapshotStore();
    const system = createTransformSnapshotSystem(world, store);
    const query = world.query(["Transform"]);
    const ctx = { dt: 1 / 60, alpha: 0, elapsed: 0, frame: 0, world };

    system.run(ctx, query);
    // Simulates a Physics-phase system integrating movement after the snapshot ran.
    world.set(entity, "Transform", { x: 10 });

    expect(store.get(entity)).toEqual({ x: 0, y: 0, rotation: 0 });
  });

  it("updates the snapshot to the new position on the next run", () => {
    const world = makeWorld();
    const entity = world.create({ Transform: { x: 0, y: 0, rotation: 0 } });
    world.flush();

    const store = new TransformSnapshotStore();
    const system = createTransformSnapshotSystem(world, store);
    const query = world.query(["Transform"]);
    const ctx = { dt: 1 / 60, alpha: 0, elapsed: 0, frame: 0, world };

    system.run(ctx, query);
    world.set(entity, "Transform", { x: 10 });
    system.run(ctx, query);

    expect(store.get(entity)).toEqual({ x: 10, y: 0, rotation: 0 });
  });

  it("drops the snapshot once an entity is destroyed", () => {
    const world = makeWorld();
    const entity = world.create({ Transform: { x: 1, y: 1, rotation: 0 } });
    world.flush();

    const store = new TransformSnapshotStore();
    const system = createTransformSnapshotSystem(world, store);
    const query = world.query(["Transform"]);
    const ctx = { dt: 1 / 60, alpha: 0, elapsed: 0, frame: 0, world };

    system.run(ctx, query);
    expect(store.get(entity)).toBeDefined();

    world.destroy(entity);
    world.flush();
    system.run(ctx, query);

    expect(store.get(entity)).toBeUndefined();
  });

  it("drops the snapshot once the Transform component is removed, even if the entity survives", () => {
    const world = makeWorld();
    const entity = world.create({ Transform: { x: 1, y: 1, rotation: 0 }, Velocity: { vx: 0, vy: 0 } });
    world.flush();

    const store = new TransformSnapshotStore();
    const system = createTransformSnapshotSystem(world, store);
    const query = world.query(["Transform"]);
    const ctx = { dt: 1 / 60, alpha: 0, elapsed: 0, frame: 0, world };

    system.run(ctx, query);
    expect(store.get(entity)).toBeDefined();

    world.remove(entity, "Transform");
    world.flush();
    system.run(ctx, query);

    expect(store.get(entity)).toBeUndefined();
  });
});
