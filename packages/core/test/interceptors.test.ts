import { describe, expect, it } from "vitest";
import { World } from "../src/ecs/world";
import { InterceptorRegistry } from "../src/events/interceptors";

type TestInterceptorMap = {
  "movement:speed": { entity: number; speed: number };
};

function makeCtx() {
  return { world: new World() };
}

describe("InterceptorRegistry", () => {
  it("returns the value unchanged when no interceptor is registered", () => {
    const registry = new InterceptorRegistry<TestInterceptorMap>();
    const result = registry.run("movement:speed", { entity: 1, speed: 100 }, makeCtx());
    expect(result).toEqual({ entity: 1, speed: 100 });
  });

  it("applies a single interceptor's transform", () => {
    const registry = new InterceptorRegistry<TestInterceptorMap>();
    registry.add("movement:speed", 50, (value) => ({ ...value, speed: value.speed * 0.7 }));

    const result = registry.run("movement:speed", { entity: 1, speed: 100 }, makeCtx());

    expect(result.speed).toBeCloseTo(70);
  });

  it("chains multiple interceptors in ascending priority order, feeding output to input", () => {
    const registry = new InterceptorRegistry<TestInterceptorMap>();
    const order: number[] = [];
    registry.add("movement:speed", 100, (value) => {
      order.push(100);
      return { ...value, speed: value.speed - 10 };
    });
    registry.add("movement:speed", 10, (value) => {
      order.push(10);
      return { ...value, speed: value.speed * 2 };
    });

    const result = registry.run("movement:speed", { entity: 1, speed: 5 }, makeCtx());

    // priority 10 runs first: 5 * 2 = 10, then priority 100: 10 - 10 = 0
    expect(order).toEqual([10, 100]);
    expect(result.speed).toBe(0);
  });

  it("breaks equal-priority ties by registration order", () => {
    const registry = new InterceptorRegistry<TestInterceptorMap>();
    const order: string[] = [];
    registry.add("movement:speed", 50, (value) => {
      order.push("first");
      return value;
    });
    registry.add("movement:speed", 50, (value) => {
      order.push("second");
      return value;
    });

    registry.run("movement:speed", { entity: 1, speed: 1 }, makeCtx());

    expect(order).toEqual(["first", "second"]);
  });

  it("tracks call count and timing per (point, module) for the profiler", () => {
    const registry = new InterceptorRegistry<TestInterceptorMap>();
    registry.add("movement:speed", 50, (value) => value, "@acme/weather-system");

    registry.run("movement:speed", { entity: 1, speed: 1 }, makeCtx());
    registry.run("movement:speed", { entity: 1, speed: 1 }, makeCtx());

    const stats = registry.getStats();
    const entry = stats.get("movement:speed::@acme/weather-system");
    expect(entry?.callCount).toBe(2);
    expect(entry?.totalMs).toBeGreaterThanOrEqual(0);
  });
});
