import { describe, expect, it } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { World } from "../src/ecs/world";

function makeWorld() {
  const world = new World();
  const components = registerCoreComponents(world);
  return { world, components };
}

describe("World: entity lifecycle", () => {
  it("create() allocates an id immediately but the entity has no components until flush()", () => {
    const { world } = makeWorld();
    const entity = world.create({ Transform: { x: 5, y: 7 } });
    expect(world.isAlive(entity)).toBe(true);
    expect(world.has(entity, "Transform")).toBe(false);

    world.flush();

    expect(world.has(entity, "Transform")).toBe(true);
    expect(world.get(entity, "Transform")).toMatchObject({ x: 5, y: 7 });
  });

  it("destroy() is deferred: entity is still alive until flush()", () => {
    const { world } = makeWorld();
    const entity = world.create();
    world.flush();

    world.destroy(entity);
    expect(world.isAlive(entity)).toBe(true);

    world.flush();
    expect(world.isAlive(entity)).toBe(false);
  });

  it("create() then destroy() in the same tick leaves nothing behind after flush", () => {
    const { world } = makeWorld();
    const entity = world.create({ Transform: { x: 1, y: 1 } });
    world.destroy(entity);
    world.flush();
    expect(world.isAlive(entity)).toBe(false);
  });

  it("get() returns undefined for a component the entity doesn't have", () => {
    const { world } = makeWorld();
    const entity = world.create({ Transform: { x: 0, y: 0 } });
    world.flush();
    expect(world.get(entity, "Velocity")).toBeUndefined();
  });

  it("set() writes immediately without needing a flush", () => {
    const { world } = makeWorld();
    const entity = world.create({ Transform: { x: 0, y: 0 } });
    world.flush();

    world.set(entity, "Transform", { x: 42 });

    expect(world.get(entity, "Transform")).toMatchObject({ x: 42, y: 0 });
  });

  it("set() throws for a component the entity doesn't have", () => {
    const { world } = makeWorld();
    const entity = world.create();
    world.flush();
    expect(() => world.set(entity, "Transform", { x: 1 })).toThrow();
  });
});

describe("World: add/remove move entities between archetypes", () => {
  it("add() moves an entity into a new archetype, preserving existing component data", () => {
    const { world } = makeWorld();
    const entity = world.create({ Transform: { x: 3, y: 4 } });
    world.flush();

    world.add(entity, "Velocity", { vx: 1, vy: 2 });
    world.flush();

    expect(world.get(entity, "Transform")).toMatchObject({ x: 3, y: 4 });
    expect(world.get(entity, "Velocity")).toMatchObject({ vx: 1, vy: 2 });
  });

  it("remove() moves an entity out, dropping only the removed component's data", () => {
    const { world } = makeWorld();
    const entity = world.create({ Transform: { x: 3, y: 4 }, Velocity: { vx: 1, vy: 2 } });
    world.flush();

    world.remove(entity, "Velocity");
    world.flush();

    expect(world.has(entity, "Velocity")).toBe(false);
    expect(world.get(entity, "Transform")).toMatchObject({ x: 3, y: 4 });
  });

  it("preserves other entities' locations when one entity's archetype changes (swap-remove correctness)", () => {
    const { world } = makeWorld();
    const a = world.create({ Transform: { x: 1, y: 1 } });
    const b = world.create({ Transform: { x: 2, y: 2 } });
    const c = world.create({ Transform: { x: 3, y: 3 } });
    world.flush();

    // Moving `a` to a different archetype triggers a swap-remove in the
    // shared Transform-only archetype; b and c must still resolve correctly.
    world.add(a, "Velocity", { vx: 9, vy: 9 });
    world.flush();

    expect(world.get(a, "Transform")).toMatchObject({ x: 1, y: 1 });
    expect(world.get(b, "Transform")).toMatchObject({ x: 2, y: 2 });
    expect(world.get(c, "Transform")).toMatchObject({ x: 3, y: 3 });
  });
});

describe("World: queries", () => {
  it("matches entities across archetypes that all carry the required components", () => {
    const { world } = makeWorld();
    const moving = world.create({ Transform: { x: 0, y: 0 }, Velocity: { vx: 1, vy: 0 } });
    const still = world.create({ Transform: { x: 5, y: 5 } });
    world.flush();

    const query = world.query(["Transform", "Velocity"]);
    const seen: number[] = [];
    query.forEach((entity) => seen.push(entity));

    expect(seen).toEqual([moving]);
    expect(seen).not.toContain(still);
  });

  it("count() reflects total matching entities across archetypes", () => {
    const { world } = makeWorld();
    world.create({ Transform: { x: 0, y: 0 } });
    world.create({ Transform: { x: 1, y: 1 } });
    world.create({ Transform: { x: 2, y: 2 }, Velocity: { vx: 0, vy: 0 } });
    world.flush();

    expect(world.query(["Transform"]).count()).toBe(3);
    expect(world.query(["Transform", "Velocity"]).count()).toBe(1);
  });

  it("forEachChunk exposes typed-array columns for zero-allocation iteration", () => {
    const { world } = makeWorld();
    world.create({ Transform: { x: 1, y: 0 }, Velocity: { vx: 2, vy: 0 } });
    world.create({ Transform: { x: 5, y: 0 }, Velocity: { vx: 3, vy: 0 } });
    world.flush();

    const query = world.query(["Transform", "Velocity"]);
    let touched = 0;
    query.forEachChunk(({ archetype, size }) => {
      const positions = archetype.column(world.components.getByName("Transform").id);
      const velocities = archetype.column(world.components.getByName("Velocity").id);
      for (let row = 0; row < size; row++) {
        positions.x![row] = positions.x![row]! + velocities.vx![row]!;
        touched++;
      }
    });

    expect(touched).toBe(2);
  });

  it("picks up newly created entities of a matching shape after a later flush", () => {
    const { world } = makeWorld();
    const query = world.query(["Transform"]);
    expect(query.count()).toBe(0);

    world.create({ Transform: { x: 0, y: 0 } });
    world.flush();

    expect(query.count()).toBe(1);
  });
});
