import { describe, expect, it } from "vitest";
import { GRID_HEIGHT, GRID_WIDTH } from "../canvas/gridConstants";
import { isPreviewTilesMessage, isPreviewToEditorMessage } from "./protocol";

const VALID_TILES = new Array(GRID_WIDTH * GRID_HEIGHT).fill(0);

describe("isPreviewTilesMessage", () => {
  it("accepts a well-formed tiles message", () => {
    expect(isPreviewTilesMessage({ type: "forge:preview:tiles", tiles: VALID_TILES })).toBe(true);
  });

  it("rejects a wrong type discriminant", () => {
    expect(isPreviewTilesMessage({ type: "forge:preview:ready" })).toBe(false);
  });

  it("rejects a tiles array of the wrong length", () => {
    expect(isPreviewTilesMessage({ type: "forge:preview:tiles", tiles: [1, 2, 3] })).toBe(false);
  });

  it("rejects a tiles array containing a non-finite value", () => {
    const bad = [...VALID_TILES];
    bad[5] = Number.NaN;
    expect(isPreviewTilesMessage({ type: "forge:preview:tiles", tiles: bad })).toBe(false);
  });

  it("rejects a tiles array containing a non-number", () => {
    const bad: unknown[] = [...VALID_TILES];
    bad[5] = "3";
    expect(isPreviewTilesMessage({ type: "forge:preview:tiles", tiles: bad })).toBe(false);
  });

  it("rejects null, primitives, and objects missing fields", () => {
    expect(isPreviewTilesMessage(null)).toBe(false);
    expect(isPreviewTilesMessage("forge:preview:tiles")).toBe(false);
    expect(isPreviewTilesMessage({})).toBe(false);
    expect(isPreviewTilesMessage({ type: "forge:preview:tiles" })).toBe(false);
  });
});

describe("isPreviewToEditorMessage", () => {
  it("accepts a ready message", () => {
    expect(isPreviewToEditorMessage({ type: "forge:preview:ready" })).toBe(true);
  });

  it("accepts an error message with a string message field", () => {
    expect(isPreviewToEditorMessage({ type: "forge:preview:error", message: "boom" })).toBe(true);
  });

  it("rejects an error message with a non-string message field", () => {
    expect(isPreviewToEditorMessage({ type: "forge:preview:error", message: 42 })).toBe(false);
  });

  it("rejects an unrecognized type and non-objects", () => {
    expect(isPreviewToEditorMessage({ type: "forge:preview:tiles", tiles: [] })).toBe(false);
    expect(isPreviewToEditorMessage(undefined)).toBe(false);
    expect(isPreviewToEditorMessage(42)).toBe(false);
  });
});
