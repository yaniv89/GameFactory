import { describe, expect, it } from "vitest";
import { GRID_HEIGHT, GRID_WIDTH } from "../canvas/gridConstants";
import type { EntityPlacement } from "../store/projectStore";
import { isPreviewSceneMessage, isPreviewToEditorMessage } from "./protocol";

const VALID_TILES = new Array(GRID_WIDTH * GRID_HEIGHT).fill(0);
const NPC: EntityPlacement = { id: "e1", prefabId: "npc", tileX: 3, tileY: 4, dialogue: { speaker: "NPC", text: "Hi" } };
const PLAYER_START: EntityPlacement = { id: "e2", prefabId: "player-start", tileX: 1, tileY: 1 };

describe("isPreviewSceneMessage", () => {
  it("accepts a well-formed scene message with entities", () => {
    expect(
      isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [NPC, PLAYER_START] }),
    ).toBe(true);
  });

  it("accepts an entity with no dialogue (player-start)", () => {
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [PLAYER_START] })).toBe(
      true,
    );
  });

  it("accepts an empty entities array", () => {
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [] })).toBe(true);
  });

  it("rejects a wrong type discriminant", () => {
    expect(isPreviewSceneMessage({ type: "forge:preview:ready" })).toBe(false);
  });

  it("rejects a tiles array of the wrong length", () => {
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: [1, 2, 3], entities: [] })).toBe(false);
  });

  it("rejects a tiles array containing a non-finite value", () => {
    const bad = [...VALID_TILES];
    bad[5] = Number.NaN;
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: bad, entities: [] })).toBe(false);
  });

  it("rejects a missing entities field", () => {
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES })).toBe(false);
  });

  it("rejects an entity with an unregistered prefabId", () => {
    const bad = { ...NPC, prefabId: "dragon" };
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [bad] })).toBe(false);
  });

  it("rejects an entity with a non-numeric tileX", () => {
    const bad = { ...NPC, tileX: "3" };
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [bad] })).toBe(false);
  });

  it("rejects an entity whose dialogue is missing a text field", () => {
    const bad = { ...NPC, dialogue: { speaker: "NPC" } };
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [bad] })).toBe(false);
  });

  it("rejects null, primitives, and objects missing fields", () => {
    expect(isPreviewSceneMessage(null)).toBe(false);
    expect(isPreviewSceneMessage("forge:preview:scene")).toBe(false);
    expect(isPreviewSceneMessage({})).toBe(false);
  });

  it("accepts a message with no activePack field (no pack installed)", () => {
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [] })).toBe(true);
  });

  it("accepts a message with a string activePack", () => {
    expect(
      isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], activePack: "@forge-fixtures/starter-pack" }),
    ).toBe(true);
  });

  it("rejects a message with a non-string activePack", () => {
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], activePack: 42 })).toBe(false);
  });

  it("accepts a message with no devSave field (nothing saved yet)", () => {
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [] })).toBe(true);
  });

  it("accepts a message with a well-formed devSave", () => {
    const devSave = { player: { Transform: { x: 1, y: 2 } }, inventory: { coin: 1 }, savedAt: "now" };
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], devSave })).toBe(true);
  });

  it("rejects a message whose devSave doesn't structurally match DevPreviewSave", () => {
    const devSave = { player: { Transform: { x: "not-a-number" } }, inventory: {}, savedAt: "now" };
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], devSave })).toBe(false);
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
    expect(isPreviewToEditorMessage({ type: "forge:preview:scene", tiles: [], entities: [] })).toBe(false);
    expect(isPreviewToEditorMessage(undefined)).toBe(false);
    expect(isPreviewToEditorMessage(42)).toBe(false);
  });

  it("accepts a save message with a well-formed DevPreviewSave payload", () => {
    const save = { player: { Transform: { x: 1, y: 2 } }, inventory: { coin: 1 }, savedAt: "now" };
    expect(isPreviewToEditorMessage({ type: "forge:preview:save", save })).toBe(true);
  });

  it("rejects a save message whose save payload doesn't structurally match DevPreviewSave", () => {
    expect(isPreviewToEditorMessage({ type: "forge:preview:save", save: { player: "nope" } })).toBe(false);
  });
});
