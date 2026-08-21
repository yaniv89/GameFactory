import { describe, expect, it } from "vitest";
import { GRID_HEIGHT, GRID_WIDTH } from "../canvas/gridConstants";
import type { EntityPlacement } from "../store/projectStore";
import { isPreviewSceneMessage, isPreviewToEditorMessage } from "./protocol";

const VALID_TILES = new Array(GRID_WIDTH * GRID_HEIGHT).fill(0);
const NPC: EntityPlacement = { id: "e1", prefabId: "npc", tileX: 3, tileY: 4, dialogue: { nodes: [{ speaker: "NPC", text: "Hi" }] } };
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

  it("rejects an entity whose dialogue has no nodes array", () => {
    const bad = { ...NPC, dialogue: { speaker: "NPC" } };
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [bad] })).toBe(false);
  });

  it("rejects an entity whose dialogue node is missing a text field", () => {
    const bad = { ...NPC, dialogue: { nodes: [{ speaker: "NPC" }] } };
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [bad] })).toBe(false);
  });

  it("rejects an entity whose dialogue nodes array is empty", () => {
    const bad = { ...NPC, dialogue: { nodes: [] } };
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [bad] })).toBe(false);
  });

  it("accepts a dialogue tree with a choice pointing at another node", () => {
    const branching = {
      ...NPC,
      dialogue: {
        nodes: [
          { speaker: "Elder", text: "Choose wisely.", choices: [{ id: "yes", text: "I will.", next: 1 }] },
          { speaker: "Elder", text: "Good choice." },
        ],
      },
    };
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [branching] })).toBe(true);
  });

  it("rejects a dialogue node whose choices array has a malformed entry", () => {
    const bad = {
      ...NPC,
      dialogue: { nodes: [{ speaker: "Elder", text: "Choose.", choices: [{ id: "yes", text: "I will." }] }] },
    };
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

  // issue #123
  it("accepts a message with no installedModules field", () => {
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [] })).toBe(true);
  });

  it("accepts a message with a well-formed installedModules array", () => {
    expect(
      isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], installedModules: ["@forge/dialogue", "@forge/inventory"] }),
    ).toBe(true);
  });

  it("accepts a message with an empty installedModules array", () => {
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], installedModules: [] })).toBe(true);
  });

  it("rejects a message whose installedModules is not an array of strings", () => {
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], installedModules: [42] })).toBe(false);
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], installedModules: "@forge/dialogue" })).toBe(false);
  });

  const VALID_GRAPH = {
    id: "g1",
    name: "kill on event",
    nodes: [
      { id: "trigger", type: "core:onEvent", position: { x: 0, y: 0 }, config: { event: "enemy:died" } },
      { id: "destroy", type: "core:destroyEntity", position: { x: 100, y: 0 }, config: {} },
    ],
    edges: [{ id: "e1", source: "trigger", target: "destroy", sourceHandle: "flow", targetHandle: "flow" }],
  };

  it("accepts a message with no graphs field", () => {
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [] })).toBe(true);
  });

  it("accepts a message with an empty graphs map", () => {
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], graphs: {} })).toBe(true);
  });

  it("accepts a message with a well-formed graph", () => {
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], graphs: { g1: VALID_GRAPH } })).toBe(true);
  });

  it("rejects a graph missing id/name", () => {
    const { id, ...missingId } = VALID_GRAPH;
    void id;
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], graphs: { g1: missingId } })).toBe(false);
  });

  it("rejects a graph whose nodes/edges aren't arrays", () => {
    expect(
      isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], graphs: { g1: { ...VALID_GRAPH, nodes: "nope" } } }),
    ).toBe(false);
    expect(
      isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], graphs: { g1: { ...VALID_GRAPH, edges: "nope" } } }),
    ).toBe(false);
  });

  it("rejects a node instance missing a required field", () => {
    const badGraph = { ...VALID_GRAPH, nodes: [{ id: "trigger", config: {} }] }; // missing "type"
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], graphs: { g1: badGraph } })).toBe(false);
  });

  it("rejects an edge instance missing a required field", () => {
    const badGraph = { ...VALID_GRAPH, edges: [{ id: "e1", source: "trigger", target: "destroy" }] }; // missing sourceHandle/targetHandle
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], graphs: { g1: badGraph } })).toBe(false);
  });

  it("rejects graphs that isn't an object at all", () => {
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], graphs: "nope" })).toBe(false);
    expect(isPreviewSceneMessage({ type: "forge:preview:scene", tiles: VALID_TILES, entities: [], graphs: null })).toBe(false);
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
