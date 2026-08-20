import { describe, expect, it } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { createKnockbackPhysicsSystem } from "../src/systems/knockbackPhysics";
import { FIXED_STEP_MS } from "../src/scheduler/phase";
import { Scheduler } from "../src/scheduler/scheduler";
import { World } from "../src/ecs/world";

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

function spawnKnockable(world: World, vx: number, vy: number, friction: number) {
  const entity = world.create({
    Transform: { x: 0, y: 0 },
    Velocity: { vx, vy, maxSpeed: 0, friction },
    Health: { current: 30, max: 30 },
  });
  world.flush();
  return entity;
}

describe("createKnockbackPhysicsSystem", () => {
  it("does nothing to an entity with no Health component (e.g. the player) — its query never matches", () => {
    const world = makeWorld();
    const entity = world.create({ Transform: { x: 0, y: 0 }, Velocity: { vx: 500, vy: 0, maxSpeed: 0, friction: 6 } });
    world.flush();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createKnockbackPhysicsSystem({ world }));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(entity, "Transform")).toMatchObject({ x: 0, y: 0 });
  });

  it("leaves a resting (zero-velocity) entity untouched", () => {
    const world = makeWorld();
    const entity = spawnKnockable(world, 0, 0, 6);

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createKnockbackPhysicsSystem({ world }));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(entity, "Transform")).toMatchObject({ x: 0, y: 0 });
    expect(world.get(entity, "Velocity")).toMatchObject({ vx: 0, vy: 0 });
  });

  it("integrates position from velocity and decays velocity toward zero via friction", () => {
    const world = makeWorld();
    const entity = spawnKnockable(world, 200, 0, 6);

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createKnockbackPhysicsSystem({ world }));

    scheduler.tick(FIXED_STEP_MS);
    const afterOneStep = world.get(entity, "Transform")!;
    const velocityAfterOneStep = world.get(entity, "Velocity")!;
    expect(afterOneStep.x).toBeGreaterThan(0);
    expect(velocityAfterOneStep.vx).toBeGreaterThan(0);
    expect(velocityAfterOneStep.vx).toBeLessThan(200); // decayed from the initial impulse

    for (let i = 0; i < 120; i++) scheduler.tick(FIXED_STEP_MS); // a couple seconds of decay
    const settledVelocity = world.get(entity, "Velocity")!;
    expect(settledVelocity.vx).toBe(0);
    expect(settledVelocity.vy).toBe(0);
  });

  it("never touches the player prefab's own [Transform, Velocity] shape — Health absence is the actual guard, not an accident of query order", () => {
    const world = makeWorld();
    const player = world.create({
      Transform: { x: 10, y: 10 },
      Velocity: { vx: -999, vy: -999, maxSpeed: 140, friction: 0 },
      PlayerControlled: { inputMapId: 0 },
    });
    world.flush();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createKnockbackPhysicsSystem({ world }));
    scheduler.tick(FIXED_STEP_MS);

    // Untouched: createPlayerMovementSystem (editor-preview/player packages,
    // not @forge/core) is the only thing allowed to move the player.
    expect(world.get(player, "Transform")).toMatchObject({ x: 10, y: 10 });
    expect(world.get(player, "Velocity")).toMatchObject({ vx: -999, vy: -999 });
  });

  it("still excludes the player even though PLAYER_START_PREFAB now carries Health too (H1e's HUD health bar) — PlayerControlled is the real guard, not Health's absence", () => {
    const world = makeWorld();
    const player = world.create({
      Transform: { x: 10, y: 10 },
      Velocity: { vx: -999, vy: -999, maxSpeed: 140, friction: 0 },
      PlayerControlled: { inputMapId: 0 },
      Health: { current: 100, max: 100 },
    });
    world.flush();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createKnockbackPhysicsSystem({ world }));
    scheduler.tick(FIXED_STEP_MS);

    // If this ever regressed, the player would silently get double-moved
    // every tick (once by createPlayerMovementSystem, once by this system
    // integrating the same Velocity) and could be shoved through walls,
    // since this system deliberately skips tile collision.
    expect(world.get(player, "Transform")).toMatchObject({ x: 10, y: 10 });
    expect(world.get(player, "Velocity")).toMatchObject({ vx: -999, vy: -999 });
  });

  it("still integrates an EnemyAi entity while it's within its own invulnerability window — hit-stun plays out as before I1a", () => {
    const world = makeWorld();
    const entity = world.create({
      Transform: { x: 0, y: 0 },
      Velocity: { vx: 200, vy: 0, maxSpeed: 90, friction: 6 },
      Health: { current: 20, max: 30, invulnerableUntil: 10 }, // still invulnerable for a long while
      EnemyAi: {},
    });
    world.flush();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createKnockbackPhysicsSystem({ world }));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(entity, "Transform")!.x).toBeGreaterThan(0);
  });

  it("stops integrating an EnemyAi entity the moment its invulnerability window has passed — I1a's own createEnemyAiSystem takes over from here, and fighting it over the same Transform would double-move the entity", () => {
    const world = makeWorld();
    const entity = world.create({
      Transform: { x: 0, y: 0 },
      Velocity: { vx: 200, vy: 0, maxSpeed: 90, friction: 6 },
      Health: { current: 20, max: 30, invulnerableUntil: 0 }, // already expired
      EnemyAi: {},
    });
    world.flush();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createKnockbackPhysicsSystem({ world }));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(entity, "Transform")).toMatchObject({ x: 0, y: 0 });
    expect(world.get(entity, "Velocity")).toMatchObject({ vx: 200, vy: 0 }); // left exactly as-is, not decayed either
  });
});
