import { describe, expect, it } from "vitest";
import type { AABB } from "../src/physics/aabb";
import { pairKey, SpatialHash } from "../src/physics/spatialHash";

function aabb(minX: number, minY: number, maxX: number, maxY: number): AABB {
  return { minX, minY, maxX, maxY };
}

function collectPairs(hash: SpatialHash): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  hash.forEachCandidatePair((a, b) => pairs.push([a, b]));
  return pairs;
}

describe("SpatialHash", () => {
  it("rejects a non-positive cell size", () => {
    expect(() => new SpatialHash(0)).toThrow();
    expect(() => new SpatialHash(-1)).toThrow();
  });

  it("reports two entities in the same cell as a candidate pair", () => {
    const hash = new SpatialHash(32);
    hash.insert(1, aabb(0, 0, 4, 4));
    hash.insert(2, aabb(1, 1, 5, 5));

    expect(collectPairs(hash)).toEqual([[1, 2]]);
  });

  it("does not pair entities in far-apart, non-adjacent cells", () => {
    const hash = new SpatialHash(32);
    hash.insert(1, aabb(0, 0, 4, 4));
    hash.insert(2, aabb(1000, 1000, 1004, 1004));

    expect(collectPairs(hash)).toEqual([]);
  });

  it("reports a pair only once even when both AABBs span several shared cells", () => {
    const hash = new SpatialHash(10);
    // Both span cells (0,0)-(1,1) in a 10-unit grid — four shared cells.
    hash.insert(1, aabb(0, 0, 15, 15));
    hash.insert(2, aabb(2, 2, 17, 17));

    expect(collectPairs(hash)).toEqual([[1, 2]]);
  });

  it("clear() removes prior entries so a stale pair isn't reported next pass", () => {
    const hash = new SpatialHash(32);
    hash.insert(1, aabb(0, 0, 4, 4));
    hash.insert(2, aabb(1, 1, 5, 5));
    expect(collectPairs(hash)).toEqual([[1, 2]]);

    hash.clear();
    hash.insert(1, aabb(0, 0, 4, 4));
    // entity 2 not re-inserted this pass
    expect(collectPairs(hash)).toEqual([]);
  });

  it("finds three mutually-overlapping entities in one cell as three distinct pairs", () => {
    const hash = new SpatialHash(32);
    hash.insert(1, aabb(0, 0, 4, 4));
    hash.insert(2, aabb(1, 1, 5, 5));
    hash.insert(3, aabb(2, 2, 6, 6));

    const pairs = collectPairs(hash).map(([a, b]) => `${a},${b}`).sort();
    expect(pairs).toEqual(["1,2", "1,3", "2,3"]);
  });
});

describe("pairKey", () => {
  it("is order-independent (unordered pair)", () => {
    expect(pairKey(3, 9)).toBe(pairKey(9, 3));
  });

  it("differs for different pairs", () => {
    expect(pairKey(1, 2)).not.toBe(pairKey(1, 3));
  });
});
