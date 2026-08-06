import { describe, expect, it } from "vitest";
import {
  aabbOverlap,
  collidersOverlap,
  computeColliderAABB,
  createAABB,
  type ColliderLike,
  type TransformLike,
} from "../src/physics/aabb";

function transform(x: number, y: number, scaleX = 1, scaleY = 1): TransformLike {
  return { x, y, scaleX, scaleY };
}

function box(width: number, height: number, offsetX = 0, offsetY = 0): ColliderLike {
  return { shape: 0, width, height, offsetX, offsetY };
}

function circle(diameter: number, offsetX = 0, offsetY = 0): ColliderLike {
  return { shape: 1, width: diameter, height: diameter, offsetX, offsetY };
}

describe("aabbOverlap", () => {
  it("is true for overlapping boxes", () => {
    expect(aabbOverlap({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { minX: 5, minY: 5, maxX: 15, maxY: 15 })).toBe(
      true,
    );
  });

  it("is true for edge-touching boxes (inclusive boundary)", () => {
    expect(aabbOverlap({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { minX: 10, minY: 0, maxX: 20, maxY: 10 })).toBe(
      true,
    );
  });

  it("is false for separated boxes", () => {
    expect(aabbOverlap({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { minX: 11, minY: 0, maxX: 20, maxY: 10 })).toBe(
      false,
    );
  });
});

describe("computeColliderAABB", () => {
  it("computes a box AABB centered on the transform plus offset", () => {
    const out = computeColliderAABB(transform(100, 100), box(20, 10, 5, -5), createAABB());
    expect(out).toEqual({ minX: 95, minY: 90, maxX: 115, maxY: 100 });
  });

  it("scales the box half-extents and offset by transform scale", () => {
    const out = computeColliderAABB(transform(0, 0, 2, 2), box(20, 10, 5, 0), createAABB());
    // center = (0 + 5*2, 0) = (10, 0); half-extents = (20/2*2, 10/2*2) = (20, 10)
    expect(out).toEqual({ minX: -10, minY: -10, maxX: 30, maxY: 10 });
  });

  it("computes a circle AABB from width/2 as the radius", () => {
    const out = computeColliderAABB(transform(50, 50), circle(20), createAABB());
    expect(out).toEqual({ minX: 40, minY: 40, maxX: 60, maxY: 60 });
  });

  it("averages non-uniform scale for a circle's effective radius", () => {
    const out = computeColliderAABB(transform(0, 0, 2, 4), circle(10), createAABB());
    // radius = (10/2) * ((2+4)/2) = 5 * 3 = 15
    expect(out).toEqual({ minX: -15, minY: -15, maxX: 15, maxY: 15 });
  });

  it("writes into the provided `out` object rather than allocating a new one", () => {
    const out = createAABB();
    const result = computeColliderAABB(transform(1, 1), box(2, 2), out);
    expect(result).toBe(out);
  });
});

describe("collidersOverlap", () => {
  const scratchA = createAABB();
  const scratchB = createAABB();

  it("box vs box: true when overlapping", () => {
    expect(
      collidersOverlap(transform(0, 0), box(10, 10), transform(5, 5), box(10, 10), scratchA, scratchB),
    ).toBe(true);
  });

  it("box vs box: false when separated", () => {
    expect(
      collidersOverlap(transform(0, 0), box(10, 10), transform(100, 100), box(10, 10), scratchA, scratchB),
    ).toBe(false);
  });

  it("circle vs circle: true when the distance is within the summed radii", () => {
    expect(
      collidersOverlap(transform(0, 0), circle(10), transform(8, 0), circle(10), scratchA, scratchB),
    ).toBe(true);
  });

  it("circle vs circle: false when the distance exceeds the summed radii", () => {
    expect(
      collidersOverlap(transform(0, 0), circle(10), transform(20, 0), circle(10), scratchA, scratchB),
    ).toBe(false);
  });

  it("circle vs box: true when the circle touches the box", () => {
    // Box spans x[-5,5] y[-5,5]. Circle centered at (10,0), radius 6 -> closest box point (5,0), distance 5 <= 6.
    expect(
      collidersOverlap(transform(10, 0), circle(12), transform(0, 0), box(10, 10), scratchA, scratchB),
    ).toBe(true);
  });

  it("circle vs box: false when the circle doesn't reach the box", () => {
    // Same setup, radius 4 -> distance 5 > 4.
    expect(
      collidersOverlap(transform(10, 0), circle(8), transform(0, 0), box(10, 10), scratchA, scratchB),
    ).toBe(false);
  });

  it("box vs circle (argument order swapped) gives the same answer as circle vs box", () => {
    const circleFirst = collidersOverlap(
      transform(10, 0),
      circle(12),
      transform(0, 0),
      box(10, 10),
      scratchA,
      scratchB,
    );
    const boxFirst = collidersOverlap(
      transform(0, 0),
      box(10, 10),
      transform(10, 0),
      circle(12),
      scratchA,
      scratchB,
    );
    expect(boxFirst).toBe(circleFirst);
  });

  it("reuses the same scratch objects across sequential calls without corrupting results", () => {
    const results: boolean[] = [];
    results.push(collidersOverlap(transform(0, 0), box(10, 10), transform(5, 5), box(10, 10), scratchA, scratchB));
    results.push(
      collidersOverlap(transform(0, 0), box(10, 10), transform(100, 100), box(10, 10), scratchA, scratchB),
    );
    results.push(collidersOverlap(transform(0, 0), box(10, 10), transform(5, 5), box(10, 10), scratchA, scratchB));
    expect(results).toEqual([true, false, true]);
  });
});
