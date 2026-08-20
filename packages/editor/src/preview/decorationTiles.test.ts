import { describe, expect, it } from "vitest";
import { GRASS_TILE_ID, WALL_TILE_ID } from "../canvas/tilePalette";
import { FLOWER_DECORATION_ID, computeDecorationTiles } from "./decorationTiles";

describe("computeDecorationTiles", () => {
  it("never places a flower on a non-Grass cell", () => {
    const ground = new Array(100).fill(WALL_TILE_ID);
    const decoration = computeDecorationTiles(ground, 10, 10);
    expect(decoration.every((id) => id === 0)).toBe(true);
  });

  it("places at least one flower across a large all-Grass field (the ~20% chance isn't accidentally 0%)", () => {
    const ground = new Array(400).fill(GRASS_TILE_ID);
    const decoration = computeDecorationTiles(ground, 20, 20);
    expect(decoration.some((id) => id === FLOWER_DECORATION_ID)).toBe(true);
  });

  it("does not flower every Grass cell (the ~20% chance isn't accidentally 100%)", () => {
    const ground = new Array(400).fill(GRASS_TILE_ID);
    const decoration = computeDecorationTiles(ground, 20, 20);
    expect(decoration.some((id) => id === 0)).toBe(true);
  });

  it("is deterministic — the same ground grid always produces the exact same decoration grid", () => {
    const ground = [GRASS_TILE_ID, WALL_TILE_ID, GRASS_TILE_ID, GRASS_TILE_ID, WALL_TILE_ID, GRASS_TILE_ID, GRASS_TILE_ID, GRASS_TILE_ID, GRASS_TILE_ID];
    const first = computeDecorationTiles(ground, 3, 3);
    const second = computeDecorationTiles(ground, 3, 3);
    expect(second).toEqual(first);
  });

  it("reacts to a live repaint — a cell that was Wall and becomes Grass can newly qualify for a flower", () => {
    const groundBefore = new Array(400).fill(GRASS_TILE_ID);
    groundBefore[0] = WALL_TILE_ID;
    const decorationBefore = computeDecorationTiles(groundBefore, 20, 20);
    expect(decorationBefore[0]).toBe(0); // Wall never flowers

    const groundAfter = [...groundBefore];
    groundAfter[0] = GRASS_TILE_ID;
    const decorationAfter = computeDecorationTiles(groundAfter, 20, 20);
    // Every other cell's own flower-or-not outcome is unaffected by this one repaint (each cell's chance depends only on its own x/y, not its neighbors).
    expect(decorationAfter.slice(1)).toEqual(decorationBefore.slice(1));
  });

  it("returns exactly gridWidth * gridHeight entries", () => {
    const ground = new Array(30).fill(GRASS_TILE_ID);
    expect(computeDecorationTiles(ground, 5, 6)).toHaveLength(30);
  });
});
