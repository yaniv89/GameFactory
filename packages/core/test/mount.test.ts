import { describe, expect, it } from "vitest";
import { MOUNT_NO_RIDER, registerCoreComponents } from "../src/components/core";
import { createMountSystem } from "../src/systems/mount";
import { FIXED_STEP_MS } from "../src/scheduler/phase";
import { Scheduler } from "../src/scheduler/scheduler";
import { World } from "../src/ecs/world";

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

function spawnPlayer(world: World, x: number, y: number, maxSpeed = 140) {
  const entity = world.create({
    Transform: { x, y },
    Velocity: { vx: 0, vy: 0, maxSpeed, friction: 0 },
    PlayerControlled: { inputMapId: 0 },
  });
  world.flush();
  return entity;
}

function spawnMount(world: World, x: number, y: number, extra: { range?: number; mountedMaxSpeed?: number } = {}) {
  const entity = world.create({
    Transform: { x, y },
    Sprite: { assetId: 5, frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 },
    Mount: { riderEntity: MOUNT_NO_RIDER, range: extra.range ?? 40, mountedMaxSpeed: extra.mountedMaxSpeed ?? 260, riderBaseMaxSpeed: 0 },
  });
  world.flush();
  return entity;
}

function makeRequester(request: boolean) {
  let pending = request;
  return () => {
    const value = pending;
    pending = false;
    return value;
  };
}

describe("createMountSystem", () => {
  it("mounts the nearest unridden mount within range: boosts the rider's speed and hides the mount's sprite", () => {
    const world = makeWorld();
    const player = spawnPlayer(world, 0, 0);
    const mount = spawnMount(world, 10, 0);

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createMountSystem({ world, consumeMountRequest: makeRequester(true) }));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(mount, "Mount")).toMatchObject({ riderEntity: player, riderBaseMaxSpeed: 140 });
    expect(world.get(player, "Velocity")).toMatchObject({ maxSpeed: 260 });
    expect(world.get(mount, "Sprite")).toMatchObject({ opacity: 0 });
  });

  it("ignores a mount outside its own range", () => {
    const world = makeWorld();
    const player = spawnPlayer(world, 0, 0);
    const mount = spawnMount(world, 1000, 0, { range: 40 });

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createMountSystem({ world, consumeMountRequest: makeRequester(true) }));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(mount, "Mount")).toMatchObject({ riderEntity: MOUNT_NO_RIDER });
    expect(world.get(player, "Velocity")).toMatchObject({ maxSpeed: 140 });
  });

  it("picks the nearest of several in-range mounts, not just the first spawned", () => {
    const world = makeWorld();
    const player = spawnPlayer(world, 0, 0);
    const far = spawnMount(world, 30, 0);
    const near = spawnMount(world, 10, 0);

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createMountSystem({ world, consumeMountRequest: makeRequester(true) }));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(near, "Mount")!.riderEntity).toBe(player);
    expect(world.get(far, "Mount")!.riderEntity).toBe(MOUNT_NO_RIDER);
  });

  it("skips a mount someone else is already riding", () => {
    const world = makeWorld();
    // Not itself a [Transform, Velocity, PlayerControlled] rider the system
    // would also process this same tick — otherwise this "someone else"
    // would be swept up by the very same request edge and dismounted
    // before `player`'s own turn runs, which is a real property of a
    // single global "E was pressed" edge affecting every rider it finds,
    // not a bug in the system under test.
    const otherRider = world.create({});
    world.flush();
    const player = spawnPlayer(world, 0, 0);
    const takenMount = spawnMount(world, 10, 0);
    world.set(takenMount, "Mount", { riderEntity: otherRider });
    world.flush();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createMountSystem({ world, consumeMountRequest: makeRequester(true) }));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(takenMount, "Mount")!.riderEntity).toBe(otherRider);
    expect(world.get(player, "Velocity")).toMatchObject({ maxSpeed: 140 });
  });

  it("dismounts on the next request regardless of distance, restoring the rider's own original speed and snapping the mount to the rider's current position", () => {
    const world = makeWorld();
    const player = spawnPlayer(world, 0, 0);
    const mount = spawnMount(world, 10, 0);

    let requested = true;
    const scheduler = new Scheduler(world);
    scheduler.addSystem(
      createMountSystem({
        world,
        consumeMountRequest: () => {
          const value = requested;
          requested = false;
          return value;
        },
      }),
    );
    scheduler.tick(FIXED_STEP_MS); // mount

    // Walk the rider far away — dismount must not depend on proximity.
    world.set(player, "Transform", { x: 999, y: 999 });
    world.flush();

    requested = true; // a fresh "E" press edge, the same shape the real caller (PreviewApp.tsx) provides
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(mount, "Mount")).toMatchObject({ riderEntity: MOUNT_NO_RIDER });
    expect(world.get(player, "Velocity")).toMatchObject({ maxSpeed: 140 });
    expect(world.get(mount, "Transform")).toMatchObject({ x: 999, y: 999 });
    expect(world.get(mount, "Sprite")).toMatchObject({ opacity: 1 });
  });

  it("does nothing at all without a fresh request, even with a mount in range", () => {
    const world = makeWorld();
    const player = spawnPlayer(world, 0, 0);
    const mount = spawnMount(world, 10, 0);

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createMountSystem({ world, consumeMountRequest: () => false }));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(mount, "Mount")).toMatchObject({ riderEntity: MOUNT_NO_RIDER });
    expect(world.get(player, "Velocity")).toMatchObject({ maxSpeed: 140 });
  });

  it("consumes the request exactly once per edge, not once per rider or per mount", () => {
    const world = makeWorld();
    const playerA = spawnPlayer(world, 0, 0);
    const playerB = spawnPlayer(world, 500, 0);
    spawnMount(world, 10, 0);
    spawnMount(world, 510, 0);

    let calls = 0;
    const scheduler = new Scheduler(world);
    scheduler.addSystem(
      createMountSystem({
        world,
        consumeMountRequest: () => {
          calls++;
          return true;
        },
      }),
    );
    scheduler.tick(FIXED_STEP_MS);

    expect(calls).toBe(1);
    void playerA;
    void playerB;
  });
});
