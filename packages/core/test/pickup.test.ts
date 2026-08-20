import { describe, expect, it } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { EventBusImpl } from "../src/events/eventBus";
import type { PickupCollectedEvent, PickupEventMap } from "../src/systems/pickup";
import { createPickupSystem } from "../src/systems/pickup";
import { FIXED_STEP_MS } from "../src/scheduler/phase";
import { Scheduler } from "../src/scheduler/scheduler";
import { World } from "../src/ecs/world";

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

function spawnPlayerAt(world: World, x: number, y: number) {
  const entity = world.create({
    Transform: { x, y },
    Collider: { shape: 1, width: 20, height: 20, isTrigger: 0 },
    PlayerControlled: { inputMapId: 0 },
  });
  world.flush();
  return entity;
}

function spawnCoinAt(world: World, x: number, y: number, itemId = 1, amount = 1) {
  const entity = world.create({
    Transform: { x, y },
    Collider: { shape: 1, width: 16, height: 16, isTrigger: 1 },
    Pickup: { itemId, amount },
  });
  world.flush();
  return entity;
}

describe("createPickupSystem", () => {
  it("does nothing when no player overlaps any pickup", () => {
    const world = makeWorld();
    spawnPlayerAt(world, 0, 0);
    const coin = spawnCoinAt(world, 500, 500);

    const events = new EventBusImpl<PickupEventMap>();
    const collected: PickupCollectedEvent[] = [];
    events.on("pickup:collected", (payload) => collected.push(payload));

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createPickupSystem({ world, events }));
    scheduler.tick(FIXED_STEP_MS);

    expect(collected).toEqual([]);
    expect(world.isAlive(coin)).toBe(true);
  });

  it("collects an overlapping pickup: emits pickup:collected with the item's own data and position, and destroys it", () => {
    const world = makeWorld();
    const player = spawnPlayerAt(world, 100, 100);
    const coin = spawnCoinAt(world, 105, 100, 1, 1);

    const events = new EventBusImpl<PickupEventMap>();
    const collected: PickupCollectedEvent[] = [];
    events.on("pickup:collected", (payload) => collected.push(payload));

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createPickupSystem({ world, events }));
    scheduler.tick(FIXED_STEP_MS);

    expect(collected).toEqual([{ player, itemId: 1, amount: 1, x: 105, y: 100 }]);
    expect(world.isAlive(coin)).toBe(false);
    expect(world.get(coin, "Pickup")).toBeUndefined();
  });

  it("leaves a pickup just outside collider range uncollected", () => {
    const world = makeWorld();
    spawnPlayerAt(world, 0, 0); // radius 10 (width 20 / 2)
    const coin = spawnCoinAt(world, 100, 0); // radius 8 (width 16 / 2), far outside 10+8

    const events = new EventBusImpl<PickupEventMap>();
    const collected: PickupCollectedEvent[] = [];
    events.on("pickup:collected", (payload) => collected.push(payload));

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createPickupSystem({ world, events }));
    scheduler.tick(FIXED_STEP_MS);

    expect(collected).toEqual([]);
    expect(world.isAlive(coin)).toBe(true);
  });

  it("collects multiple pickups the player overlaps in the same tick", () => {
    const world = makeWorld();
    spawnPlayerAt(world, 0, 0);
    const coinA = spawnCoinAt(world, 2, 0, 1, 1);
    const coinB = spawnCoinAt(world, -2, 1, 1, 1);

    const events = new EventBusImpl<PickupEventMap>();
    const collected: PickupCollectedEvent[] = [];
    events.on("pickup:collected", (payload) => collected.push(payload));

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createPickupSystem({ world, events }));
    scheduler.tick(FIXED_STEP_MS);

    expect(collected).toHaveLength(2);
    expect(world.isAlive(coinA)).toBe(false);
    expect(world.isAlive(coinB)).toBe(false);
  });

  it("does nothing when there is no player entity at all", () => {
    const world = makeWorld();
    const coin = spawnCoinAt(world, 0, 0);

    const events = new EventBusImpl<PickupEventMap>();
    const collected: PickupCollectedEvent[] = [];
    events.on("pickup:collected", (payload) => collected.push(payload));

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createPickupSystem({ world, events }));
    scheduler.tick(FIXED_STEP_MS);

    expect(collected).toEqual([]);
    expect(world.isAlive(coin)).toBe(true);
  });
});
