import { describe, expect, it } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { createCollisionSystem, type CollisionEventMap, type CollisionPairEvent } from "../src/physics/collisionSystem";
import { EventBusImpl } from "../src/events/eventBus";
import { InputState } from "../src/input/inputState";
import { SceneManager } from "../src/scene/sceneManager";
import { World } from "../src/ecs/world";
import type { TickContext } from "../src/scheduler/tickContext";

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

function ctx(world: World): TickContext {
  return { dt: 1 / 60, alpha: 0, elapsed: 0, frame: 0, world, input: new InputState(), scene: new SceneManager("") };
}

describe("createCollisionSystem", () => {
  it("does not fire collision:enter for entities whose colliders don't overlap", () => {
    const world = makeWorld();
    world.create({ Transform: { x: 0, y: 0 }, Collider: { width: 10, height: 10 } });
    world.create({ Transform: { x: 1000, y: 1000 }, Collider: { width: 10, height: 10 } });
    world.flush();

    const events = new EventBusImpl<CollisionEventMap>();
    let enterCalls = 0;
    events.on("collision:enter", () => enterCalls++);

    const system = createCollisionSystem({ world, events, cellSize: 32 });
    system.run(ctx(world), world.query(["Transform", "Collider"]));

    expect(enterCalls).toBe(0);
  });

  it("fires collision:enter exactly once when two entities start overlapping, not again while they keep overlapping", () => {
    const world = makeWorld();
    const a = world.create({ Transform: { x: 0, y: 0 }, Collider: { width: 10, height: 10 } });
    const b = world.create({ Transform: { x: 5, y: 0 }, Collider: { width: 10, height: 10 } });
    world.flush();

    const events = new EventBusImpl<CollisionEventMap>();
    const enters: CollisionPairEvent[] = [];
    events.on("collision:enter", (e) => enters.push(e));

    const system = createCollisionSystem({ world, events, cellSize: 32 });
    const query = world.query(["Transform", "Collider"]);

    system.run(ctx(world), query);
    system.run(ctx(world), query);
    system.run(ctx(world), query);

    expect(enters).toHaveLength(1);
    expect([enters[0]!.a, enters[0]!.b].sort()).toEqual([a, b].sort());
  });

  it("fires collision:exit when two overlapping entities move apart", () => {
    const world = makeWorld();
    const a = world.create({ Transform: { x: 0, y: 0 }, Collider: { width: 10, height: 10 } });
    world.create({ Transform: { x: 5, y: 0 }, Collider: { width: 10, height: 10 } });
    world.flush();

    const events = new EventBusImpl<CollisionEventMap>();
    const exits: CollisionPairEvent[] = [];
    events.on("collision:exit", (e) => exits.push(e));

    const system = createCollisionSystem({ world, events, cellSize: 32 });
    const query = world.query(["Transform", "Collider"]);

    system.run(ctx(world), query);
    world.set(a, "Transform", { x: 1000 });
    system.run(ctx(world), query);

    expect(exits).toHaveLength(1);
  });

  it("reports isTrigger and layer from each side's own Collider values", () => {
    const world = makeWorld();
    world.create({
      Transform: { x: 0, y: 0 },
      Collider: { width: 10, height: 10, isTrigger: 1, layer: 3 },
    });
    world.create({
      Transform: { x: 5, y: 0 },
      Collider: { width: 10, height: 10, isTrigger: 0, layer: 7 },
    });
    world.flush();

    const events = new EventBusImpl<CollisionEventMap>();
    let captured: CollisionPairEvent | undefined;
    events.on("collision:enter", (e) => {
      captured = e;
    });

    const system = createCollisionSystem({ world, events, cellSize: 32 });
    system.run(ctx(world), world.query(["Transform", "Collider"]));

    expect(captured).toBeDefined();
    const triggerSide = captured!.aIsTrigger ? "a" : "b";
    if (triggerSide === "a") {
      expect(captured!.aIsTrigger).toBe(true);
      expect(captured!.aLayer).toBe(3);
      expect(captured!.bIsTrigger).toBe(false);
      expect(captured!.bLayer).toBe(7);
    } else {
      expect(captured!.bIsTrigger).toBe(true);
      expect(captured!.bLayer).toBe(3);
      expect(captured!.aIsTrigger).toBe(false);
      expect(captured!.aLayer).toBe(7);
    }
  });

  it("fires collision:exit when an overlapping entity is destroyed", () => {
    const world = makeWorld();
    const a = world.create({ Transform: { x: 0, y: 0 }, Collider: { width: 10, height: 10 } });
    world.create({ Transform: { x: 5, y: 0 }, Collider: { width: 10, height: 10 } });
    world.flush();

    const events = new EventBusImpl<CollisionEventMap>();
    const exits: CollisionPairEvent[] = [];
    events.on("collision:exit", (e) => exits.push(e));

    const system = createCollisionSystem({ world, events, cellSize: 32 });
    const query = world.query(["Transform", "Collider"]);

    system.run(ctx(world), query);
    world.destroy(a);
    world.flush();
    system.run(ctx(world), query);

    expect(exits).toHaveLength(1);
  });

  it("ignores entities that only have Transform without a Collider", () => {
    const world = makeWorld();
    world.create({ Transform: { x: 0, y: 0 } });
    world.create({ Transform: { x: 1, y: 0 } });
    world.flush();

    const events = new EventBusImpl<CollisionEventMap>();
    let enterCalls = 0;
    events.on("collision:enter", () => enterCalls++);

    const system = createCollisionSystem({ world, events, cellSize: 32 });
    system.run(ctx(world), world.query(["Transform", "Collider"]));

    expect(enterCalls).toBe(0);
  });
});
