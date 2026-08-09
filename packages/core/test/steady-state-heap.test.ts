import { describe, expect, it } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { createCollisionSystem, type CollisionEventMap } from "../src/physics/collisionSystem";
import { EventBusImpl } from "../src/events/eventBus";
import { Scheduler } from "../src/scheduler/scheduler";
import type { SystemDefinition } from "../src/scheduler/system";
import { World } from "../src/ecs/world";

/**
 * The real proof CLAUDE.md Section 1.3 guardrail 14 ("never allocate
 * inside the fixed-step frame loop") demands, promised in
 * `query-steady-state.test.ts`'s doc comment: a heap-growth measurement
 * across a real full simulation tick (movement system + collision
 * detection together), not just Query's own cache.
 *
 * Requires `--expose-gc` (this package's `test` script sets it via
 * NODE_OPTIONS — see package.json). Without it, `global.gc` is undefined
 * and this test is skipped rather than silently passing on an unforced,
 * noisy heap reading.
 */

const FIXED_STEP_MS = 1000 / 60;
const ENTITY_COUNT = 1000;
const WARMUP_TICKS = 60;
const MEASURED_TICKS = 300;
// Generous on purpose: this asserts against a real per-tick-allocation
// regression (e.g. 1000 entities x 300 ticks x even a tiny 24-byte object
// is already 7.2 MB), not against ordinary GC/JIT noise. The actual
// number is printed either way.
const MAX_ACCEPTABLE_GROWTH_BYTES = 5 * 1024 * 1024;

function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

function buildScheduler(entityCount: number): Scheduler {
  const world = new World();
  registerCoreComponents(world);

  const columns = Math.ceil(Math.sqrt(entityCount));
  const worldSize = columns * 48;

  for (let i = 0; i < entityCount; i++) {
    world.create({
      Transform: { x: (i % columns) * 48, y: Math.floor(i / columns) * 48 },
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
  scheduler.addSystem(createCollisionSystem({ world, events, cellSize: 64 }));
  return scheduler;
}

describe("steady-state heap growth: Update (movement) + Physics (AABB collision)", () => {
  const gc = (global as { gc?: () => void }).gc;

  it.skipIf(!gc)(
    `heap growth over ${MEASURED_TICKS} fixed steps at ${ENTITY_COUNT} entities stays under ${(
      MAX_ACCEPTABLE_GROWTH_BYTES /
      1024 /
      1024
    ).toFixed(1)} MB, after a ${WARMUP_TICKS}-tick warmup`,
    () => {
      const scheduler = buildScheduler(ENTITY_COUNT);

      for (let i = 0; i < WARMUP_TICKS; i++) scheduler.tick(FIXED_STEP_MS);

      gc!();
      const heapBefore = process.memoryUsage().heapUsed;

      for (let i = 0; i < MEASURED_TICKS; i++) scheduler.tick(FIXED_STEP_MS);

      gc!();
      const heapAfter = process.memoryUsage().heapUsed;

      const growthBytes = heapAfter - heapBefore;
      console.log(
        `steady-state-heap: ${growthBytes} bytes growth over ${MEASURED_TICKS} ticks ` +
          `(${(growthBytes / MEASURED_TICKS).toFixed(1)} bytes/tick) at ${ENTITY_COUNT} entities`,
      );

      expect(growthBytes).toBeLessThan(MAX_ACCEPTABLE_GROWTH_BYTES);
    },
  );
});
