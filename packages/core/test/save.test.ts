import { describe, expect, it } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { World } from "../src/ecs/world";
import { deserializeWorld, serializeEntity, serializeWorld } from "../src/save/serialize";

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

describe("save: serializeWorld / deserializeWorld round trip", () => {
  it("round-trips component data at the exact original entity ids", () => {
    const world = makeWorld();
    const a = world.create({ Transform: { x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1 } });
    const b = world.create({ Transform: { x: 3, y: 4, rotation: 0, scaleX: 1, scaleY: 1 }, Velocity: { vx: 5, vy: 6, maxSpeed: 10, friction: 0 } });
    world.flush();

    const saved = serializeWorld(world);
    expect(saved.entities).toHaveLength(2);

    const restored = makeWorld();
    deserializeWorld(restored, saved);

    expect(restored.isAlive(a)).toBe(true);
    expect(restored.isAlive(b)).toBe(true);
    expect(restored.get(a, "Transform")).toMatchObject({ x: 1, y: 2 });
    expect(restored.get(b, "Transform")).toMatchObject({ x: 3, y: 4 });
    expect(restored.get(b, "Velocity")).toMatchObject({ vx: 5, vy: 6 });
    expect(restored.has(a, "Velocity")).toBe(false);
  });

  it("round-trips an entity with zero components", () => {
    const world = makeWorld();
    const bare = world.create();
    world.flush();

    const restored = makeWorld();
    deserializeWorld(restored, serializeWorld(world));

    expect(restored.isAlive(bare)).toBe(true);
    expect(restored.componentsOf(bare)).toEqual([]);
  });

  it("restored entities support create()/destroy() afterward without id collisions", () => {
    const world = makeWorld();
    world.create({ Transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } }); // index 0
    const keep = world.create({ Transform: { x: 9, y: 9, rotation: 0, scaleX: 1, scaleY: 1 } }); // index 1
    world.flush();

    const saved = serializeWorld(world);
    // Simulate the first entity having been destroyed before save: only "keep" is in the save.
    const partialSave = { entities: saved.entities.filter((e) => e.id === keep), nextEntityId: saved.nextEntityId };

    const restored = makeWorld();
    deserializeWorld(restored, partialSave);
    expect(restored.isAlive(keep)).toBe(true);

    // Index 0 was never restored — it must still be usable by a fresh create(), not stranded.
    const fresh = restored.create({ Transform: { x: 1, y: 1, rotation: 0, scaleX: 1, scaleY: 1 } });
    restored.flush();
    expect(restored.isAlive(fresh)).toBe(true);
    expect(fresh).not.toBe(keep);
  });

  it("restoring entities out of index order still leaves every gap reachable", () => {
    const world = makeWorld();
    const ids = [] as number[];
    for (let i = 0; i < 5; i++) {
      ids.push(world.create({ Transform: { x: i, y: 0, rotation: 0, scaleX: 1, scaleY: 1 } }));
    }
    world.flush();

    const saved = serializeWorld(world);
    const shuffled = { entities: [...saved.entities].reverse(), nextEntityId: saved.nextEntityId };

    const restored = makeWorld();
    deserializeWorld(restored, shuffled);
    for (const id of ids) {
      expect(restored.isAlive(id)).toBe(true);
    }
  });
});

describe("save: serializeEntity", () => {
  it("captures exactly one entity's own components, not the rest of the world", () => {
    const world = makeWorld();
    const a = world.create({ Transform: { x: 1, y: 2, rotation: 0, scaleX: 1, scaleY: 1 } });
    world.create({ Transform: { x: 9, y: 9, rotation: 0, scaleX: 1, scaleY: 1 } }); // a second entity — must not leak into `a`'s snapshot
    world.flush();

    const snapshot = serializeEntity(world, a);
    expect(Object.keys(snapshot)).toEqual(["Transform"]);
    expect(snapshot.Transform).toMatchObject({ x: 1, y: 2 });
  });

  it("round-trips through world.create(), landing at a freshly-allocated id rather than the original one", () => {
    const world = makeWorld();
    const original = world.create({ Transform: { x: 5, y: 6, rotation: 0, scaleX: 1, scaleY: 1 }, Velocity: { vx: 1, vy: 2, maxSpeed: 100, friction: 0 } });
    world.flush();
    const snapshot = serializeEntity(world, original);

    const restored = world.create(snapshot);
    world.flush();

    expect(restored).not.toBe(original);
    expect(world.get(restored, "Transform")).toMatchObject({ x: 5, y: 6 });
    expect(world.get(restored, "Velocity")).toMatchObject({ vx: 1, vy: 2, maxSpeed: 100 });
  });

  it("returns an empty object for an entity with no components", () => {
    const world = makeWorld();
    const bare = world.create();
    world.flush();
    expect(serializeEntity(world, bare)).toEqual({});
  });
});
