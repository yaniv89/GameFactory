import { describe, expect, it } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { World } from "../src/ecs/world";
import {
  ENEMY_PREFAB,
  NPC_PREFAB,
  PLAYER_START_PREFAB,
  PREFAB_IDS,
  getPrefab,
  isPrefabId,
  spawnFromPrefab,
  type Prefab,
} from "../src/prefabs/prefab";

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

describe("PREFAB_IDS / getPrefab / isPrefabId", () => {
  it("registers exactly the three first-party prefabs (docs/adr/0015 decision 3; enemy added in H1c)", () => {
    expect([...PREFAB_IDS].sort()).toEqual(["enemy", "npc", "player-start"]);
  });

  it("getPrefab resolves a known id and returns undefined for an unknown one", () => {
    expect(getPrefab("player-start")).toBe(PLAYER_START_PREFAB);
    expect(getPrefab("npc")).toBe(NPC_PREFAB);
    expect(getPrefab("enemy")).toBe(ENEMY_PREFAB);
    expect(getPrefab("dragon")).toBeUndefined();
  });

  it("isPrefabId is true only for a registered id, not any string", () => {
    expect(isPrefabId("player-start")).toBe(true);
    expect(isPrefabId("npc")).toBe(true);
    expect(isPrefabId("dragon")).toBe(false);
    expect(isPrefabId(42)).toBe(false);
    expect(isPrefabId(undefined)).toBe(false);
  });
});

describe("spawnFromPrefab", () => {
  it("spawns PLAYER_START_PREFAB with the exact component values spawnPlayer used to hardcode", () => {
    const world = makeWorld();
    const entity = spawnFromPrefab(world, PLAYER_START_PREFAB, 100, 200, () => 1);
    world.flush();

    expect(world.get(entity, "Transform")).toMatchObject({ x: 100, y: 200, z: 0, rotation: 0, scaleX: 1, scaleY: 1 });
    expect(world.get(entity, "Sprite")).toMatchObject({
      assetId: 1,
      frame: 0,
      anchorX: 0.5,
      anchorY: 0.5,
      tint: 0xffffff,
      opacity: 1,
    });
    expect(world.get(entity, "Velocity")).toMatchObject({ vx: 0, vy: 0, maxSpeed: 140, friction: 0 });
    expect(world.get(entity, "Collider")).toMatchObject({
      shape: 1,
      width: 0,
      height: 0,
      offsetX: 0,
      offsetY: 0,
      isTrigger: 0,
      layer: 0,
    });
    expect(world.get(entity, "PlayerControlled")).toMatchObject({ inputMapId: 0 });
    expect(world.get(entity, "Animator")).toMatchObject({ clipId: -1, playing: 0, speed: 1, loop: 1, elapsed: 0, facing: 0 });
    // NPC_PREFAB declares no Interactable component — neither should PLAYER_START_PREFAB spawn one.
    expect(world.has(entity, "Interactable")).toBe(false);
  });

  it("spawns NPC_PREFAB with Transform, Sprite, and Animator — no Velocity/Collider/PlayerControlled", () => {
    const world = makeWorld();
    const entity = spawnFromPrefab(world, NPC_PREFAB, 10, 20, () => 2);
    world.flush();

    expect(world.get(entity, "Transform")).toMatchObject({ x: 10, y: 20 });
    expect(world.get(entity, "Sprite")).toMatchObject({ assetId: 2, frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 });
    expect(world.get(entity, "Animator")).toMatchObject({ clipId: -1, playing: 0, speed: 1, loop: 1, elapsed: 0, facing: 0 });
    expect(world.has(entity, "Velocity")).toBe(false);
    expect(world.has(entity, "Collider")).toBe(false);
    expect(world.has(entity, "PlayerControlled")).toBe(false);
  });

  it("spawns ENEMY_PREFAB with a real box Collider, Velocity, and full Health — the H1c combat target shape", () => {
    const world = makeWorld();
    const entity = spawnFromPrefab(world, ENEMY_PREFAB, 50, 60, () => 3);
    world.flush();

    expect(world.get(entity, "Transform")).toMatchObject({ x: 50, y: 60 });
    expect(world.get(entity, "Sprite")).toMatchObject({ assetId: 3, frame: 0 });
    expect(world.get(entity, "Velocity")).toMatchObject({ vx: 0, vy: 0, maxSpeed: 0, friction: 6 });
    expect(world.get(entity, "Collider")).toMatchObject({ shape: 0, width: 24, height: 24, isTrigger: 0 });
    expect(world.get(entity, "Health")).toMatchObject({ current: 30, max: 30, invulnerableUntil: 0, flashUntil: 0 });
    expect(world.has(entity, "PlayerControlled")).toBe(false);
  });

  it("calls resolveSpriteAssetId with the prefab's own spriteAssetKey, not a hardcoded id", () => {
    const world = makeWorld();
    const seen: string[] = [];
    spawnFromPrefab(world, PLAYER_START_PREFAB, 0, 0, (key) => {
      seen.push(key);
      return 99;
    });
    world.flush();
    expect(seen).toEqual(["player"]);
  });

  it("does not resolve a sprite asset id at all for a prefab with no spriteAssetKey", () => {
    const world = makeWorld();
    const noSprite: Prefab = { id: "invisible-trigger", label: "Invisible trigger", components: { collider: { shape: 0, isTrigger: 1 } } };
    let called = false;
    const entity = spawnFromPrefab(world, noSprite, 0, 0, () => {
      called = true;
      return -1;
    });
    world.flush();

    expect(called).toBe(false);
    expect(world.has(entity, "Sprite")).toBe(false);
    expect(world.get(entity, "Collider")).toMatchObject({ shape: 0, isTrigger: 1 });
  });

  it("falls back to a placeholder asset id (-1) when spriteAssetKey has no resolution — never leaves assetId at the registry default silently", () => {
    const world = makeWorld();
    const entity = spawnFromPrefab(world, PLAYER_START_PREFAB, 0, 0, () => -1);
    world.flush();
    expect(world.get(entity, "Sprite")).toMatchObject({ assetId: -1 });
  });
});
