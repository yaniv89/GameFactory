import { describe, expect, it } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { EventBusImpl } from "../src/events/eventBus";
import { createEnemyAiSystem, type EnemyAiSystemOptions } from "../src/systems/enemyAi";
import type { MeleeAttackEventMap, MeleeHitEvent } from "../src/systems/meleeAttack";
import { FIXED_STEP_MS } from "../src/scheduler/phase";
import { Scheduler } from "../src/scheduler/scheduler";
import { World } from "../src/ecs/world";

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

function spawnEnemy(world: World, x: number, y: number, extra: { invulnerableUntil?: number; attackCooldownUntil?: number } = {}) {
  const entity = world.create({
    Transform: { x, y },
    Velocity: { vx: 0, vy: 0, maxSpeed: 90, friction: 6 },
    Health: { current: 30, max: 30, invulnerableUntil: extra.invulnerableUntil ?? 0, flashUntil: 0 },
    EnemyAi: { homeX: x, homeY: y, wanderTargetX: x, wanderTargetY: y, attackCooldownUntil: extra.attackCooldownUntil ?? 0 },
  });
  world.flush();
  return entity;
}

function spawnPlayer(world: World, x: number, y: number, invulnerableUntil = 0) {
  const entity = world.create({
    Transform: { x, y },
    Velocity: { vx: 0, vy: 0, maxSpeed: 140, friction: 0 },
    Health: { current: 100, max: 100, invulnerableUntil, flashUntil: 0 },
    PlayerControlled: { inputMapId: 0 },
  });
  world.flush();
  return entity;
}

const DETECT_RADIUS = 100;
const ATTACK_RANGE = 20;
const ATTACK_DAMAGE = 5;
const ATTACK_COOLDOWN_SEC = 1;
const ATTACK_INVULN_SEC = 0.4;
const ATTACK_FLASH_SEC = 0.15;
const WANDER_RADIUS = 30;
const WANDER_SPEED = 20;

function makeSystem(world: World, events: EventBusImpl<MeleeAttackEventMap>, overrides: Partial<EnemyAiSystemOptions> = {}) {
  return createEnemyAiSystem({
    world,
    events,
    detectRadius: DETECT_RADIUS,
    attackRange: ATTACK_RANGE,
    attackDamage: ATTACK_DAMAGE,
    attackCooldownSec: ATTACK_COOLDOWN_SEC,
    attackInvulnerabilitySec: ATTACK_INVULN_SEC,
    attackFlashSec: ATTACK_FLASH_SEC,
    wanderRadius: WANDER_RADIUS,
    wanderSpeed: WANDER_SPEED,
    ...overrides,
  });
}

describe("createEnemyAiSystem", () => {
  it("wanders near its own home when no player exists — moves, doesn't just sit still", () => {
    const world = makeWorld();
    const enemy = spawnEnemy(world, 100, 100);
    // Force an immediate wander-target repick by starting far from it.
    world.set(enemy, "EnemyAi", { wanderTargetX: 150, wanderTargetY: 100 });
    world.flush();

    const events = new EventBusImpl<MeleeAttackEventMap>();
    const scheduler = new Scheduler(world);
    scheduler.addSystem(makeSystem(world, events));
    scheduler.tick(FIXED_STEP_MS);

    const transform = world.get(enemy, "Transform")!;
    expect(transform.x).toBeGreaterThan(100); // moved toward its wander target
  });

  it("picks a new wander target once it arrives at the current one, staying within wanderRadius of home", () => {
    const world = makeWorld();
    const enemy = spawnEnemy(world, 100, 100);
    // Already "arrived" at its own wander target (which starts equal to home).
    const events = new EventBusImpl<MeleeAttackEventMap>();
    const scheduler = new Scheduler(world);
    scheduler.addSystem(makeSystem(world, events));
    scheduler.tick(FIXED_STEP_MS);

    const ai = world.get(enemy, "EnemyAi")!;
    const distanceFromHome = Math.hypot(ai.wanderTargetX! - 100, ai.wanderTargetY! - 100);
    expect(distanceFromHome).toBeLessThanOrEqual(WANDER_RADIUS + 0.001);
  });

  it("chases a player within detectRadius but outside attackRange, moving directly toward them", () => {
    const world = makeWorld();
    const enemy = spawnEnemy(world, 0, 0);
    spawnPlayer(world, 60, 0); // within detect (100), outside attack (20)

    const events = new EventBusImpl<MeleeAttackEventMap>();
    const scheduler = new Scheduler(world);
    scheduler.addSystem(makeSystem(world, events));
    scheduler.tick(FIXED_STEP_MS);

    const transform = world.get(enemy, "Transform")!;
    expect(transform.x).toBeGreaterThan(0);
    expect(transform.x).toBeLessThan(60); // hasn't overshot into the player
    const velocity = world.get(enemy, "Velocity")!;
    expect(velocity.vx).toBeGreaterThan(0);
  });

  it("ignores a player entirely outside detectRadius", () => {
    const world = makeWorld();
    const enemy = spawnEnemy(world, 0, 0);
    spawnPlayer(world, 500, 0);

    const events = new EventBusImpl<MeleeAttackEventMap>();
    const scheduler = new Scheduler(world);
    scheduler.addSystem(makeSystem(world, events));
    scheduler.tick(FIXED_STEP_MS);

    const transform = world.get(enemy, "Transform")!;
    expect(transform.x).toBeCloseTo(0, 5); // wandering near its own home (0,0), not toward the far player
  });

  it("stops and attacks once within attackRange, dealing real damage and emitting combat:hit", () => {
    const world = makeWorld();
    const enemy = spawnEnemy(world, 0, 0);
    const player = spawnPlayer(world, 10, 0); // within attackRange (20)

    const events = new EventBusImpl<MeleeAttackEventMap>();
    const hits: MeleeHitEvent[] = [];
    events.on("combat:hit", (payload) => hits.push(payload));
    const scheduler = new Scheduler(world);
    scheduler.addSystem(makeSystem(world, events));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(enemy, "Velocity")).toMatchObject({ vx: 0, vy: 0 });
    expect(hits).toEqual([{ attacker: enemy, target: player, damage: ATTACK_DAMAGE, targetHealthRemaining: 100 - ATTACK_DAMAGE }]);
    const playerHealth = world.get(player, "Health")!;
    expect(playerHealth.current).toBe(100 - ATTACK_DAMAGE);
    expect(playerHealth.invulnerableUntil).toBeGreaterThan(0);
  });

  it("does not attack again until its own cooldown elapses, even across many ticks", () => {
    const world = makeWorld();
    const enemy = spawnEnemy(world, 0, 0);
    spawnPlayer(world, 10, 0);

    const events = new EventBusImpl<MeleeAttackEventMap>();
    const hits: MeleeHitEvent[] = [];
    events.on("combat:hit", (payload) => hits.push(payload));
    const scheduler = new Scheduler(world);
    scheduler.addSystem(makeSystem(world, events));

    scheduler.tick(FIXED_STEP_MS); // lands the first hit
    expect(hits).toHaveLength(1);

    for (let i = 0; i < 30; i++) scheduler.tick(FIXED_STEP_MS); // 0.5s — still within both the enemy's cooldown and the player's own i-frames
    expect(hits).toHaveLength(1);
  });

  it("attacks again once its cooldown and the player's own invulnerability have both passed", () => {
    const world = makeWorld();
    const enemy = spawnEnemy(world, 0, 0);
    spawnPlayer(world, 10, 0);

    const events = new EventBusImpl<MeleeAttackEventMap>();
    const hits: MeleeHitEvent[] = [];
    events.on("combat:hit", (payload) => hits.push(payload));
    const scheduler = new Scheduler(world);
    scheduler.addSystem(makeSystem(world, events));

    scheduler.tick(FIXED_STEP_MS);
    expect(hits).toHaveLength(1);

    for (let i = 0; i < 70; i++) scheduler.tick(FIXED_STEP_MS); // well past ATTACK_COOLDOWN_SEC (1s)
    expect(hits).toHaveLength(2);
  });

  it("never emits combat:hit against a player still inside their own invulnerability window", () => {
    const world = makeWorld();
    const enemy = spawnEnemy(world, 0, 0);
    spawnPlayer(world, 10, 0, 10); // invulnerable for a long while

    const events = new EventBusImpl<MeleeAttackEventMap>();
    const hits: MeleeHitEvent[] = [];
    events.on("combat:hit", (payload) => hits.push(payload));
    const scheduler = new Scheduler(world);
    scheduler.addSystem(makeSystem(world, events));
    scheduler.tick(FIXED_STEP_MS);

    expect(hits).toEqual([]);
  });

  it("clamps player health at 0 rather than going negative, and never emits combat:death for the player (no death/respawn design exists yet — a stated, honest gap)", () => {
    const world = makeWorld();
    const enemy = spawnEnemy(world, 0, 0);
    const player = world.create({
      Transform: { x: 10, y: 0 },
      Velocity: { vx: 0, vy: 0, maxSpeed: 140, friction: 0 },
      Health: { current: 2, max: 100, invulnerableUntil: 0, flashUntil: 0 }, // one hit (damage 5) would go negative
      PlayerControlled: { inputMapId: 0 },
    });
    world.flush();

    const events = new EventBusImpl<MeleeAttackEventMap>();
    const deaths: unknown[] = [];
    events.on("combat:death", (payload) => deaths.push(payload));
    const scheduler = new Scheduler(world);
    scheduler.addSystem(makeSystem(world, events));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(player, "Health")!.current).toBe(0);
    expect(deaths).toEqual([]);
    expect(world.isAlive(player)).toBe(true); // never destroyed, unlike a killed enemy
    void enemy;
  });

  it("does nothing at all while hit-stunned (still within its own invulnerability window) — createKnockbackPhysicsSystem owns it during this window", () => {
    const world = makeWorld();
    const enemy = spawnEnemy(world, 0, 0, { invulnerableUntil: 10 });
    spawnPlayer(world, 10, 0);

    const events = new EventBusImpl<MeleeAttackEventMap>();
    const hits: MeleeHitEvent[] = [];
    events.on("combat:hit", (payload) => hits.push(payload));
    const scheduler = new Scheduler(world);
    scheduler.addSystem(makeSystem(world, events));
    scheduler.tick(FIXED_STEP_MS);

    expect(hits).toEqual([]);
    expect(world.get(enemy, "Transform")).toMatchObject({ x: 0, y: 0 });
    expect(world.get(enemy, "Velocity")).toMatchObject({ vx: 0, vy: 0 }); // untouched — not even zeroed by this system
  });

  it("respects a caller-supplied isWalkable during chase, sliding along a blocked axis instead of stopping outright", () => {
    const world = makeWorld();
    const enemy = spawnEnemy(world, 0, 0);
    spawnPlayer(world, 60, 60); // diagonal — chase would move both axes

    const events = new EventBusImpl<MeleeAttackEventMap>();
    const scheduler = new Scheduler(world);
    // Block all eastward movement (x increasing), leaving south (y increasing) open.
    scheduler.addSystem(makeSystem(world, events, { isWalkable: (x) => x <= 0 }));
    scheduler.tick(FIXED_STEP_MS);

    const transform = world.get(enemy, "Transform")!;
    expect(transform.x).toBe(0); // blocked axis: unmoved
    expect(transform.y).toBeGreaterThan(0); // open axis: still moved
  });
});
