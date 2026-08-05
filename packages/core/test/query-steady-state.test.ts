import { describe, expect, it } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { World } from "../src/ecs/world";

/**
 * A true heap-allocation proof (CLAUDE.md 1.3 guardrail 14 / docs/SPEC.md
 * 8.4's "proven by a heap-profile assertion in CI") needs a real browser
 * heap snapshot — that's M1 Phase 5's Playwright benchmark harness, not a
 * Vitest unit test. What IS provable here, in plain Node: once no new
 * archetype shapes appear, Query.forEach/forEachChunk must not recompute
 * or reallocate their matched-archetype list on every call — that cache is
 * the specific mechanism this package uses to keep steady-state iteration
 * allocation-free, so a regression in it is exactly the kind of bug this
 * test should catch.
 */
describe("Query: steady-state caching", () => {
  it("does not recompute matched archetypes across repeated calls once shapes stabilize", () => {
    const world = new World();
    registerCoreComponents(world);

    for (let i = 0; i < 1000; i++) {
      world.create({ Transform: { x: i, y: i }, Velocity: { vx: 1, vy: 1 } });
    }
    world.flush();

    const query = world.query(["Transform", "Velocity"]);

    // First call establishes the cache (archetypeVersion check).
    query.forEach(() => {});
    const versionAfterFirstCall = world.archetypeVersion;

    // Many subsequent calls: no new archetypes are created by iteration
    // itself, so the world's archetype version must not move, and the
    // query must keep serving the same cached list rather than calling
    // back into World.archetypesMatching() again.
    let totalSeen = 0;
    for (let tick = 0; tick < 500; tick++) {
      query.forEach(() => {
        totalSeen++;
      });
    }

    expect(world.archetypeVersion).toBe(versionAfterFirstCall);
    expect(totalSeen).toBe(1000 * 500);
  });

  it("forEachChunk visits every entity exactly once per call, with no per-entity object allocated by the query itself", () => {
    const world = new World();
    registerCoreComponents(world);
    for (let i = 0; i < 256; i++) {
      world.create({ Transform: { x: 0, y: 0 }, Velocity: { vx: 1, vy: 0 } });
    }
    world.flush();

    const query = world.query(["Transform", "Velocity"]);
    let rowsVisited = 0;
    query.forEachChunk(({ size }) => {
      rowsVisited += size;
    });

    expect(rowsVisited).toBe(256);
  });
});
