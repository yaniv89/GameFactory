import { describe, expect, it } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { createVfxParticleSystem, spawnVfxBurst } from "../src/systems/vfx";
import { FIXED_STEP_MS } from "../src/scheduler/phase";
import { Scheduler } from "../src/scheduler/scheduler";
import { World } from "../src/ecs/world";

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

const PARTICLE_ASSET_ID = 7;

describe("spawnVfxBurst", () => {
  it("spawns exactly `count` sibling particle entities at the burst origin, each with the given tint/asset/ttl", () => {
    const world = makeWorld();
    spawnVfxBurst(world, 100, 200, { count: 6, minSpeed: 60, maxSpeed: 160, ttl: 0.5, tint: 0xff8800, particleAssetId: PARTICLE_ASSET_ID });
    world.flush();

    const query = world.query(["Transform", "Velocity", "Sprite", "VfxParticle"]);
    let seen = 0;
    query.forEach((entity) => {
      seen++;
      expect(world.get(entity, "Transform")).toMatchObject({ x: 100, y: 200 });
      expect(world.get(entity, "Sprite")).toMatchObject({ assetId: PARTICLE_ASSET_ID, tint: 0xff8800, opacity: 1 });
      expect(world.get(entity, "VfxParticle")).toMatchObject({ age: 0, ttl: 0.5 });
    });
    expect(seen).toBe(6);
  });

  it("spreads particles across a real range of directions and speeds, not one repeated vector", () => {
    const world = makeWorld();
    spawnVfxBurst(world, 0, 0, { count: 12, minSpeed: 40, maxSpeed: 200, ttl: 0.5, tint: 0xffffff, particleAssetId: PARTICLE_ASSET_ID });
    world.flush();

    const velocities: { vx: number; vy: number }[] = [];
    world.query(["Velocity", "VfxParticle"]).forEach((entity) => {
      const velocity = world.get(entity, "Velocity")!;
      velocities.push({ vx: velocity.vx!, vy: velocity.vy! });
      const speed = Math.hypot(velocity.vx!, velocity.vy!);
      expect(speed).toBeGreaterThanOrEqual(40);
      expect(speed).toBeLessThanOrEqual(200);
    });
    // Not every particle flying the same direction.
    const distinctDirections = new Set(velocities.map((v) => Math.round(Math.atan2(v.vy, v.vx) * 100)));
    expect(distinctDirections.size).toBeGreaterThan(1);
  });

  it("does not call world.flush() itself — the caller owns that, matching spawnCoinPickup's own convention", () => {
    const world = makeWorld();
    spawnVfxBurst(world, 0, 0, { count: 1, minSpeed: 1, maxSpeed: 1, ttl: 0.5, tint: 0xffffff, particleAssetId: PARTICLE_ASSET_ID });
    // Not flushed yet — the query shouldn't see anything.
    let seen = 0;
    world.query(["VfxParticle"]).forEach(() => seen++);
    expect(seen).toBe(0);
    world.flush();
    world.query(["VfxParticle"]).forEach(() => seen++);
    expect(seen).toBe(1);
  });
});

describe("createVfxParticleSystem", () => {
  it("moves each particle in a straight line at its own spawn velocity", () => {
    const world = makeWorld();
    const entity = world.create({
      Transform: { x: 0, y: 0 },
      Velocity: { vx: 100, vy: 0, maxSpeed: 0, friction: 0 },
      Sprite: { assetId: PARTICLE_ASSET_ID, frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 },
      VfxParticle: { age: 0, ttl: 1 },
    });
    world.flush();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createVfxParticleSystem({ world }));
    scheduler.tick(FIXED_STEP_MS);

    const transform = world.get(entity, "Transform")!;
    expect(transform.x).toBeGreaterThan(0);
    expect(transform.y).toBe(0);
  });

  it("fades Sprite.opacity linearly to 0 as age approaches ttl", () => {
    const world = makeWorld();
    const entity = world.create({
      Transform: { x: 0, y: 0 },
      Velocity: { vx: 0, vy: 0, maxSpeed: 0, friction: 0 },
      Sprite: { assetId: PARTICLE_ASSET_ID, frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 },
      VfxParticle: { age: 0, ttl: 0.1 },
    });
    world.flush();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createVfxParticleSystem({ world }));
    scheduler.tick(FIXED_STEP_MS); // 16ms — partway through a 100ms ttl

    const sprite = world.get(entity, "Sprite")!;
    expect(sprite.opacity).toBeGreaterThan(0);
    expect(sprite.opacity).toBeLessThan(1);
  });

  it("destroys the particle once age passes ttl, never leaving it behind", () => {
    const world = makeWorld();
    const entity = world.create({
      Transform: { x: 0, y: 0 },
      Velocity: { vx: 10, vy: 0, maxSpeed: 0, friction: 0 },
      Sprite: { assetId: PARTICLE_ASSET_ID, frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 },
      VfxParticle: { age: 0, ttl: 0.05 },
    });
    world.flush();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createVfxParticleSystem({ world }));
    for (let i = 0; i < 10; i++) scheduler.tick(FIXED_STEP_MS); // well past a 50ms ttl

    expect(world.isAlive(entity)).toBe(false);
  });

  it("does nothing to an entity missing any of the four required components", () => {
    const world = makeWorld();
    const noVfxTag = world.create({
      Transform: { x: 0, y: 0 },
      Velocity: { vx: 50, vy: 0, maxSpeed: 0, friction: 0 },
      Sprite: { assetId: PARTICLE_ASSET_ID, frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 },
    });
    world.flush();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createVfxParticleSystem({ world }));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(noVfxTag, "Transform")).toMatchObject({ x: 0, y: 0 }); // untouched — not queried at all without VfxParticle
  });
});
