import { bench, describe } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { createCollisionSystem, type CollisionEventMap } from "../src/physics/collisionSystem";
import { EventBusImpl } from "../src/events/eventBus";
import { Scheduler } from "../src/scheduler/scheduler";
import type { SystemDefinition } from "../src/scheduler/system";
import { World } from "../src/ecs/world";

/**
 * Statistical throughput for CLAUDE.md's M1 exit criterion ("5000
 * entities at 60fps reference desktop, 1000 at 60fps Pixel 6a"). Run
 * with `pnpm --filter @forge/core run bench`.
 *
 * ⚠ This measures wall-clock time on whatever CPU runs it — which, in
 * this sandbox, is not any device in docs/SPEC.md Section 18.3's
 * reference matrix (Moto G Power 2021, Pixel 6a, 2019 MacBook Air, Ryzen
 * 5/GTX 1660). Sign-off against those specific numbers needs a real
 * device farm, which isn't funded yet (docs/proposals/0001 Section
 * 6.2/6.2.1) — see bench/README.md. What these numbers ARE good for:
 * regression tracking on whatever machine runs them, and an honest
 * proxy for "does the ECS/collision cost scale the way it should."
 */

const FIXED_STEP_MS = 1000 / 60;
// Entity spacing chosen to land at roughly 2 entities per broad-phase cell
// at 5000 entities (cellSize 64 below) — a plausible top-down-RPG density,
// not the pathological case of packing every collider on top of its
// neighbors. A too-dense initial layout would make the spatial hash's
// per-cell candidate count blow up (O(k^2) in entities-per-cell) and the
// benchmark would be measuring that degenerate case, not typical scaling.
const ENTITY_SPACING = 48;
const CELL_SIZE = 64;

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function buildScheduler(entityCount: number): Scheduler {
  const world = new World();
  registerCoreComponents(world);

  const columns = Math.ceil(Math.sqrt(entityCount));
  const worldSize = columns * ENTITY_SPACING;

  for (let i = 0; i < entityCount; i++) {
    world.create({
      Transform: { x: (i % columns) * ENTITY_SPACING, y: Math.floor(i / columns) * ENTITY_SPACING },
      Velocity: { vx: ((i % 7) - 3) * 10, vy: ((i % 5) - 2) * 10 },
      Sprite: {},
      Collider: { width: 16, height: 16 },
    });
  }
  world.flush();

  const transformId = world.components.getByName("Transform").id;
  const velocityId = world.components.getByName("Velocity").id;

  const movement: SystemDefinition = {
    id: "bench:Movement",
    phase: "Update",
    query: ["Transform", "Velocity"],
    run: (ctx, entities) => {
      entities.forEachChunk(({ archetype, size }) => {
        const t = archetype.column(transformId);
        const v = archetype.column(velocityId);
        for (let row = 0; row < size; row++) {
          t.x![row] = wrap(t.x![row]! + v.vx![row]! * ctx.dt, worldSize);
          t.y![row] = wrap(t.y![row]! + v.vy![row]! * ctx.dt, worldSize);
        }
      });
    },
  };

  const events = new EventBusImpl<CollisionEventMap>();
  const scheduler = new Scheduler(world);
  scheduler.addSystem(movement);
  scheduler.addSystem(createCollisionSystem({ world, events, cellSize: CELL_SIZE }));
  return scheduler;
}

describe("fixed-step simulation: Update (movement) + Physics (AABB collision), one tick", () => {
  const scheduler1000 = buildScheduler(1000);
  bench("1000 entities", () => {
    scheduler1000.tick(FIXED_STEP_MS);
  });

  const scheduler5000 = buildScheduler(5000);
  bench("5000 entities", () => {
    scheduler5000.tick(FIXED_STEP_MS);
  });
});
