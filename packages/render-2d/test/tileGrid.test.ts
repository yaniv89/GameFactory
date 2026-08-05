import { describe, expect, it } from "vitest";
import { tileCoordsFromIndex, tileFrameRect, tileIndex, tileRangeInBounds } from "../src/tileGrid";

describe("tileIndex / tileCoordsFromIndex", () => {
  it("round-trips coordinates through an index", () => {
    const width = 10;
    for (const [x, y] of [
      [0, 0],
      [9, 0],
      [0, 9],
      [3, 4],
    ]) {
      const index = tileIndex(x!, y!, width);
      expect(tileCoordsFromIndex(index, width)).toEqual({ x, y });
    }
  });

  it("is row-major", () => {
    expect(tileIndex(0, 1, 10)).toBe(10);
    expect(tileIndex(1, 0, 10)).toBe(1);
  });
});

describe("tileFrameRect", () => {
  it("returns undefined for the empty tile id", () => {
    expect(tileFrameRect(0, 8, 32)).toBeUndefined();
  });

  it("maps tile id 1 to the atlas's top-left cell", () => {
    expect(tileFrameRect(1, 8, 32)).toEqual({ x: 0, y: 0, width: 32, height: 32 });
  });

  it("wraps to the next row after `tilesetColumns` tiles", () => {
    // 8 columns: tile id 9 (1-based) is the first tile of row 2.
    expect(tileFrameRect(9, 8, 32)).toEqual({ x: 0, y: 32, width: 32, height: 32 });
  });

  it("computes the correct column mid-row", () => {
    // tile id 5 -> zero-based 4 -> column 4, row 0
    expect(tileFrameRect(5, 8, 32)).toEqual({ x: 128, y: 0, width: 32, height: 32 });
  });
});

describe("tileRangeInBounds", () => {
  it("clamps to the grid extent", () => {
    const range = tileRangeInBounds({ left: -1000, top: -1000, right: 1000, bottom: 1000 }, 10, 8, 32);
    expect(range).toEqual({ minX: 0, minY: 0, maxX: 9, maxY: 7 });
  });

  it("computes a tight range for a small viewport", () => {
    // Viewport covering world (32,32)-(96,96) at tileSize 32 -> tiles (1,1)-(3,3)
    const range = tileRangeInBounds({ left: 32, top: 32, right: 96, bottom: 96 }, 10, 10, 32);
    expect(range).toEqual({ minX: 1, minY: 1, maxX: 3, maxY: 3 });
  });
});
