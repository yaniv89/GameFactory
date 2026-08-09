import { describe, expect, it } from "vitest";
import { EntityAllocator, entityGeneration, entityIndex } from "../src/ecs/entity";

describe("EntityAllocator", () => {
  it("allocates increasing indices with generation 0", () => {
    const allocator = new EntityAllocator();
    const a = allocator.create();
    const b = allocator.create();
    expect(entityIndex(a)).toBe(0);
    expect(entityIndex(b)).toBe(1);
    expect(entityGeneration(a)).toBe(0);
    expect(entityGeneration(b)).toBe(0);
  });

  it("recycles a destroyed index and bumps its generation", () => {
    const allocator = new EntityAllocator();
    const a = allocator.create();
    allocator.destroy(a);
    const c = allocator.create();
    expect(entityIndex(c)).toBe(entityIndex(a));
    expect(entityGeneration(c)).toBe(entityGeneration(a) + 1);
  });

  it("treats a stale (pre-recycle) id as not alive after recycling", () => {
    const allocator = new EntityAllocator();
    const a = allocator.create();
    allocator.destroy(a);
    allocator.create(); // recycles a's index with a bumped generation
    expect(allocator.isAlive(a)).toBe(false);
  });

  it("throws destroying an id that is not alive", () => {
    const allocator = new EntityAllocator();
    const a = allocator.create();
    allocator.destroy(a);
    expect(() => allocator.destroy(a)).toThrow();
  });

  it("tracks the alive count through create/destroy", () => {
    const allocator = new EntityAllocator();
    const a = allocator.create();
    allocator.create();
    expect(allocator.count).toBe(2);
    allocator.destroy(a);
    expect(allocator.count).toBe(1);
  });

  it("grows capacity beyond the initial size without losing prior generations", () => {
    const allocator = new EntityAllocator(2);
    const ids = Array.from({ length: 10 }, () => allocator.create());
    for (const id of ids) {
      expect(allocator.isAlive(id)).toBe(true);
    }
  });
});
