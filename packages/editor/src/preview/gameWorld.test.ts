import { registerCoreComponents, Scheduler, TransformSchema, World } from "@forge/core";
import { describe, expect, it } from "vitest";
import { createPlayerMovementSystem, spawnPlayer } from "./gameWorld";

const ALWAYS_WALKABLE = () => true;

function setup(keysHeld: Set<string>, isWalkable: (x: number, y: number) => boolean = ALWAYS_WALKABLE) {
  const world = new World();
  registerCoreComponents(world);
  const scheduler = new Scheduler(world);
  const player = spawnPlayer(world, 100, 100);
  world.flush();
  scheduler.addSystem(createPlayerMovementSystem(world, isWalkable, keysHeld));
  return { world, scheduler, player };
}

function transformOf(world: World, entity: number) {
  return world.get<typeof TransformSchema>(entity, "Transform")!;
}

describe("createPlayerMovementSystem", () => {
  it("does not move the player when no keys are held", () => {
    const { world, scheduler, player } = setup(new Set());
    scheduler.tick(16);
    const transform = transformOf(world, player);
    expect(transform.x).toBe(100);
    expect(transform.y).toBe(100);
  });

  it("moves right when ArrowRight is held, leaving y unchanged", () => {
    const { world, scheduler, player } = setup(new Set(["ArrowRight"]));
    for (let i = 0; i < 30; i++) scheduler.tick(16);
    const transform = transformOf(world, player);
    expect(transform.x).toBeGreaterThan(100);
    expect(transform.y).toBe(100);
  });

  it("moves diagonally at normalized speed, not full speed on both axes", () => {
    const withDiagonal = setup(new Set(["ArrowRight", "ArrowDown"]));
    for (let i = 0; i < 30; i++) withDiagonal.scheduler.tick(16);
    const diagonal = transformOf(withDiagonal.world, withDiagonal.player);
    const dx = diagonal.x - 100;
    const dy = diagonal.y - 100;

    const straight = setup(new Set(["ArrowRight"]));
    for (let i = 0; i < 30; i++) straight.scheduler.tick(16);
    const straightDx = transformOf(straight.world, straight.player).x - 100;

    expect(dx).toBeCloseTo(dy, 5);
    // Normalized: each axis travels straightDx/sqrt(2), so the total
    // diagonal speed matches straight-line speed rather than being
    // sqrt(2)x faster (unnormalized diagonal movement).
    expect(dx).toBeCloseTo(straightDx / Math.SQRT2, 1);
  });

  it("blocks movement on an axis isWalkable rejects, but allows the other (sliding along a wall)", () => {
    const { world, scheduler, player } = setup(new Set(["ArrowRight", "ArrowDown"]), (x, y) => y <= 100);
    for (let i = 0; i < 30; i++) scheduler.tick(16);
    const transform = transformOf(world, player);
    expect(transform.x).toBeGreaterThan(100); // x still allowed
    expect(transform.y).toBe(100); // y blocked
  });

  it("blocks movement entirely when isWalkable always rejects", () => {
    const { world, scheduler, player } = setup(new Set(["ArrowRight"]), () => false);
    for (let i = 0; i < 30; i++) scheduler.tick(16);
    const transform = transformOf(world, player);
    expect(transform.x).toBe(100);
    expect(transform.y).toBe(100);
  });
});
