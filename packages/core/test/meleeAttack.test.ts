import { describe, expect, it, vi } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { EventBusImpl } from "../src/events/eventBus";
import { FACING_EAST, FACING_NORTH } from "../src/systems/characterAnimation";
import { createMeleeAttackSystem, type MeleeAttackEventMap } from "../src/systems/meleeAttack";
import { Scheduler } from "../src/scheduler/scheduler";
import { FIXED_STEP_MS } from "../src/scheduler/phase";
import { World } from "../src/ecs/world";

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

function spawnPlayer(world: World, x: number, y: number, facing: number) {
  const entity = world.create({
    Transform: { x, y },
    Animator: { facing },
    PlayerControlled: { inputMapId: 0 },
  });
  world.flush();
  return entity;
}

function spawnEnemy(world: World, x: number, y: number, health = 30) {
  const entity = world.create({
    Transform: { x, y },
    Collider: { shape: 0, width: 24, height: 24 },
    Velocity: { vx: 0, vy: 0, maxSpeed: 0, friction: 6 },
    Health: { current: health, max: health, invulnerableUntil: 0, flashUntil: 0 },
  });
  world.flush();
  return entity;
}

/** A one-shot "attack requested" flag — the same shape editor-preview/player's own keydown handler would drive `consumeAttackRequest` from. */
function attackFlag() {
  let requested = false;
  return {
    request: () => {
      requested = true;
    },
    consume: () => {
      const value = requested;
      requested = false;
      return value;
    },
  };
}

const REACH = 24;
const SIZE = 20;
const DAMAGE = 10;
const KNOCKBACK = 200;
const INVULN_SEC = 0.3;
const FLASH_SEC = 0.15;

function makeSystem(world: World, events: EventBusImpl<MeleeAttackEventMap>, consumeAttackRequest: () => boolean) {
  return createMeleeAttackSystem({
    world,
    events,
    consumeAttackRequest,
    reach: REACH,
    size: SIZE,
    damage: DAMAGE,
    knockbackSpeed: KNOCKBACK,
    invulnerabilitySec: INVULN_SEC,
    flashSec: FLASH_SEC,
  });
}

describe("createMeleeAttackSystem", () => {
  it("does nothing when no attack is requested", () => {
    const world = makeWorld();
    spawnPlayer(world, 0, 0, FACING_EAST);
    const enemy = spawnEnemy(world, REACH, 0);
    const events = new EventBusImpl<MeleeAttackEventMap>();
    const onHit = vi.fn();
    events.on("combat:hit", onHit);

    const scheduler = new Scheduler(world);
    scheduler.addSystem(makeSystem(world, events, () => false));
    scheduler.tick(FIXED_STEP_MS);

    expect(onHit).not.toHaveBeenCalled();
    expect(world.get(enemy, "Health")).toMatchObject({ current: 30 });
  });

  it("damages, knocks back, and flashes a target inside the facing-direction hitbox", () => {
    const world = makeWorld();
    const player = spawnPlayer(world, 0, 0, FACING_EAST);
    const enemy = spawnEnemy(world, REACH, 0);
    const events = new EventBusImpl<MeleeAttackEventMap>();
    const onHit = vi.fn();
    events.on("combat:hit", onHit);
    const flag = attackFlag();
    flag.request();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(makeSystem(world, events, flag.consume));
    scheduler.tick(FIXED_STEP_MS);

    expect(onHit).toHaveBeenCalledTimes(1);
    expect(onHit).toHaveBeenCalledWith(
      expect.objectContaining({ attacker: player, target: enemy, damage: DAMAGE, targetHealthRemaining: 20 }),
    );
    const health = world.get(enemy, "Health")!;
    expect(health.current).toBe(20);
    expect(health.invulnerableUntil).toBeGreaterThan(0);
    expect(health.flashUntil).toBeGreaterThan(0);

    // Knocked back away from the player (east), not toward it.
    const velocity = world.get(enemy, "Velocity")!;
    expect(velocity.vx).toBeGreaterThan(0);
    expect(velocity.vy).toBeCloseTo(0, 5);
    expect(Math.hypot(velocity.vx!, velocity.vy!)).toBeCloseTo(KNOCKBACK, 1);
  });

  it("misses a target outside the hitbox even if it's a plausible combat target", () => {
    const world = makeWorld();
    spawnPlayer(world, 0, 0, FACING_EAST);
    const farEnemy = spawnEnemy(world, 1000, 1000, 30);
    const events = new EventBusImpl<MeleeAttackEventMap>();
    const onHit = vi.fn();
    events.on("combat:hit", onHit);
    const flag = attackFlag();
    flag.request();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(makeSystem(world, events, flag.consume));
    scheduler.tick(FIXED_STEP_MS);

    expect(onHit).not.toHaveBeenCalled();
    expect(world.get(farEnemy, "Health")).toMatchObject({ current: 30 });
  });

  it("aims the hitbox along the player's current facing, not always east", () => {
    const world = makeWorld();
    spawnPlayer(world, 0, 0, FACING_NORTH);
    const enemyNorth = spawnEnemy(world, 0, -REACH);
    const enemyEast = spawnEnemy(world, REACH, 0);
    const events = new EventBusImpl<MeleeAttackEventMap>();
    const onHit = vi.fn();
    events.on("combat:hit", onHit);
    const flag = attackFlag();
    flag.request();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(makeSystem(world, events, flag.consume));
    scheduler.tick(FIXED_STEP_MS);

    expect(onHit).toHaveBeenCalledTimes(1);
    expect(onHit).toHaveBeenCalledWith(expect.objectContaining({ target: enemyNorth }));
    expect(world.get(enemyEast, "Health")).toMatchObject({ current: 30 });
  });

  it("does not re-hit a target still inside its own invulnerability window", () => {
    const world = makeWorld();
    spawnPlayer(world, 0, 0, FACING_EAST);
    const enemy = spawnEnemy(world, REACH, 0);
    const events = new EventBusImpl<MeleeAttackEventMap>();
    const onHit = vi.fn();
    events.on("combat:hit", onHit);
    const flag = attackFlag();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(makeSystem(world, events, flag.consume));

    flag.request();
    scheduler.tick(FIXED_STEP_MS);
    flag.request();
    scheduler.tick(FIXED_STEP_MS); // well within INVULN_SEC of the first hit

    expect(onHit).toHaveBeenCalledTimes(1);
    expect(world.get(enemy, "Health")).toMatchObject({ current: 20 });
  });

  it("never lets a target's health drop below zero", () => {
    const world = makeWorld();
    spawnPlayer(world, 0, 0, FACING_EAST);
    const enemy = spawnEnemy(world, REACH, 0, 5); // less than one hit's worth of health
    const events = new EventBusImpl<MeleeAttackEventMap>();
    const flag = attackFlag();
    flag.request();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(makeSystem(world, events, flag.consume));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(enemy, "Health")).toMatchObject({ current: 0 });
  });
});
