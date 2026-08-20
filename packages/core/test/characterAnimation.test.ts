import { describe, expect, it } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { FIXED_STEP_MS } from "../src/scheduler/phase";
import { Scheduler } from "../src/scheduler/scheduler";
import { World } from "../src/ecs/world";
import { createCharacterAnimationSystem, FACING_EAST, FACING_NORTH, FACING_SOUTH, FACING_WEST } from "../src/systems/characterAnimation";

const FRAME_COUNT = 4;
const FPS = 8;

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

function spawnAnimated(world: World, vx: number, vy: number) {
  const entity = world.create({
    Transform: { x: 0, y: 0 },
    Sprite: { assetId: 1, frame: 0 },
    Animator: { facing: FACING_SOUTH },
    Velocity: { vx, vy, maxSpeed: 140, friction: 0 },
  });
  world.flush();
  return entity;
}

describe("createCharacterAnimationSystem", () => {
  it("does nothing to an entity with no Velocity component (a static NPC) — its query never matches", () => {
    const world = makeWorld();
    const entity = world.create({
      Transform: { x: 0, y: 0 },
      Sprite: { assetId: 2, frame: 0 },
      Animator: { facing: FACING_SOUTH },
    });
    world.flush();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createCharacterAnimationSystem({ world, frameCount: FRAME_COUNT, fps: FPS }));
    scheduler.tick(1000);

    expect(world.get(entity, "Sprite")).toMatchObject({ frame: 0 });
  });

  it("parks a stopped entity on frame 0 of its last facing row, and marks Animator.playing false", () => {
    const world = makeWorld();
    const entity = spawnAnimated(world, 0, 0);
    world.set(entity, "Animator", { facing: FACING_EAST });

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createCharacterAnimationSystem({ world, frameCount: FRAME_COUNT, fps: FPS }));
    scheduler.tick(1000);

    expect(world.get(entity, "Sprite")).toMatchObject({ frame: FACING_EAST * FRAME_COUNT + 0 });
    expect(world.get(entity, "Animator")).toMatchObject({ playing: 0, facing: FACING_EAST });
  });

  it("picks facing from the dominant velocity axis: east/west for horizontal, north/south for vertical", () => {
    const world = makeWorld();
    const east = spawnAnimated(world, 100, 0);
    const west = spawnAnimated(world, -100, 0);
    const north = spawnAnimated(world, 0, -100);
    const south = spawnAnimated(world, 0, 100);

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createCharacterAnimationSystem({ world, frameCount: FRAME_COUNT, fps: FPS }));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(east, "Animator")).toMatchObject({ facing: FACING_EAST });
    expect(world.get(west, "Animator")).toMatchObject({ facing: FACING_WEST });
    expect(world.get(north, "Animator")).toMatchObject({ facing: FACING_NORTH });
    expect(world.get(south, "Animator")).toMatchObject({ facing: FACING_SOUTH });
  });

  it("cycles through frameCount columns over one full walk-cycle duration, then wraps", () => {
    const world = makeWorld();
    const entity = spawnAnimated(world, 100, 0); // moving east, well above the default moving threshold

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createCharacterAnimationSystem({ world, frameCount: FRAME_COUNT, fps: FPS }));

    const seenColumns: number[] = [];
    const stepMs = (1000 / FPS) * 0.5; // sample twice per frame's nominal duration
    const cycleMs = (FRAME_COUNT / FPS) * 1000;
    for (let t = 0; t < cycleMs * 1.5; t += stepMs) {
      scheduler.tick(stepMs);
      const sprite = world.get(entity, "Sprite")!;
      seenColumns.push(sprite.frame! - FACING_EAST * FRAME_COUNT);
    }

    // Every observed column is a valid frame index, and the sequence
    // actually advances (not stuck on one frame) and wraps back to 0
    // within a cycle-and-a-half of ticks.
    expect(seenColumns.every((c) => c >= 0 && c < FRAME_COUNT)).toBe(true);
    expect(new Set(seenColumns).size).toBeGreaterThan(1);
    expect(seenColumns).toContain(0);
  });

  it("treats a sub-threshold velocity (collision-blocked residue) as stopped, not moving", () => {
    const world = makeWorld();
    const entity = spawnAnimated(world, 0.5, 0.5); // well under the default movingThreshold of 2

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createCharacterAnimationSystem({ world, frameCount: FRAME_COUNT, fps: FPS }));
    scheduler.tick(1000);

    expect(world.get(entity, "Animator")).toMatchObject({ playing: 0 });
  });
});
