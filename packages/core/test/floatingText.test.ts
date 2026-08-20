import { describe, expect, it } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { createFloatingTextSystem } from "../src/systems/floatingText";
import { FIXED_STEP_MS } from "../src/scheduler/phase";
import { Scheduler } from "../src/scheduler/scheduler";
import { World } from "../src/ecs/world";

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

function spawnFloatingText(world: World, y: number, ttl: number, value = 10) {
  const entity = world.create({ Transform: { x: 0, y }, FloatingText: { value, age: 0, ttl } });
  world.flush();
  return entity;
}

describe("createFloatingTextSystem", () => {
  it("drifts upward and ages while inside its own ttl", () => {
    const world = makeWorld();
    const entity = spawnFloatingText(world, 0, 1);

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createFloatingTextSystem({ world, riseSpeed: 40 }));
    scheduler.tick(FIXED_STEP_MS);

    const transform = world.get(entity, "Transform")!;
    const floatingText = world.get(entity, "FloatingText")!;
    expect(transform.y).toBeLessThan(0); // drifted up (negative y is "up")
    expect(floatingText.age).toBeGreaterThan(0);
    expect(floatingText.age).toBeLessThan(1);
  });

  it("destroys itself once age passes ttl", () => {
    const world = makeWorld();
    const entity = spawnFloatingText(world, 0, 0.1); // very short-lived

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createFloatingTextSystem({ world }));

    for (let i = 0; i < 20; i++) scheduler.tick(FIXED_STEP_MS); // ~0.33s, well past ttl

    expect(world.isAlive(entity)).toBe(false);
  });

  it("does not touch an entity with no FloatingText component", () => {
    const world = makeWorld();
    const entity = world.create({ Transform: { x: 0, y: 100 } });
    world.flush();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createFloatingTextSystem({ world }));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(entity, "Transform")).toMatchObject({ y: 100 });
  });
});
