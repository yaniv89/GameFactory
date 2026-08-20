import { describe, expect, it } from "vitest";
import { AUTOTILE_EAST, AUTOTILE_NORTH, AUTOTILE_SOUTH, AUTOTILE_WEST, computeAutotileBitmask } from "../src/autotile";

const WALL = 4;
const GROUND = 1;

describe("computeAutotileBitmask", () => {
  it("returns 0 for a fully isolated tile (no matching neighbor on any side)", () => {
    // 3x3 grid, all GROUND except the center, which is WALL.
    const tiles = [GROUND, GROUND, GROUND, GROUND, WALL, GROUND, GROUND, GROUND, GROUND];
    expect(computeAutotileBitmask(tiles, 1, 1, 3, 3, WALL)).toBe(0);
  });

  it("returns 15 (every bit set) for a wall fully enclosed by walls", () => {
    const tiles = new Array(9).fill(WALL);
    expect(computeAutotileBitmask(tiles, 1, 1, 3, 3, WALL)).toBe(AUTOTILE_NORTH | AUTOTILE_EAST | AUTOTILE_SOUTH | AUTOTILE_WEST);
  });

  it("sets exactly the bit for a single matching neighbor — north", () => {
    // 1x3 column: north neighbor is WALL, center is WALL, south is GROUND.
    const tiles = [WALL, WALL, GROUND];
    expect(computeAutotileBitmask(tiles, 0, 1, 1, 3, WALL)).toBe(AUTOTILE_NORTH);
  });

  it("sets exactly the bit for a single matching neighbor — east", () => {
    const tiles = [GROUND, WALL, WALL]; // 3x1 row, center is WALL, east is WALL
    expect(computeAutotileBitmask(tiles, 1, 0, 3, 1, WALL)).toBe(AUTOTILE_EAST);
  });

  it("sets exactly the bit for a single matching neighbor — south", () => {
    const tiles = [GROUND, WALL, WALL];
    expect(computeAutotileBitmask(tiles, 0, 1, 1, 3, WALL)).toBe(AUTOTILE_SOUTH);
  });

  it("sets exactly the bit for a single matching neighbor — west", () => {
    const tiles = [WALL, WALL, GROUND];
    expect(computeAutotileBitmask(tiles, 1, 0, 3, 1, WALL)).toBe(AUTOTILE_WEST);
  });

  it("treats a map edge (no neighbor at all) the same as a non-matching neighbor — the corner of a walled map", () => {
    // 2x2 grid, all WALL. Top-left corner has no north or west neighbor at all.
    const tiles = [WALL, WALL, WALL, WALL];
    expect(computeAutotileBitmask(tiles, 0, 0, 2, 2, WALL)).toBe(AUTOTILE_EAST | AUTOTILE_SOUTH);
  });

  it("combines multiple matching sides correctly — an L-shaped corner", () => {
    // 3x3 grid: a wall corridor turning at the center — north and east are WALL, south and west are GROUND.
    const tiles = [GROUND, WALL, GROUND, GROUND, WALL, WALL, GROUND, GROUND, GROUND];
    expect(computeAutotileBitmask(tiles, 1, 1, 3, 3, WALL)).toBe(AUTOTILE_NORTH | AUTOTILE_EAST);
  });

  it("does not mutate the input grid and allocates nothing observable (pure function)", () => {
    const tiles = [WALL, WALL, WALL, WALL];
    const before = [...tiles];
    computeAutotileBitmask(tiles, 0, 0, 2, 2, WALL);
    expect(tiles).toEqual(before);
  });
});
