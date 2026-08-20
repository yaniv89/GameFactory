import { describe, expect, it } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { World } from "../src/ecs/world";
import {
  COIN_ITEM_ID,
  COIN_PICKUP_PREFAB,
  ENEMY_PREFAB,
  MOUNT_PREFAB,
  NPC_PREFAB,
  PLAYER_START_PREFAB,
  PREFAB_IDS,
  getPrefab,
  isPrefabId,
  spawnFromPrefab,
  type Prefab,
} from "../src/prefabs/prefab";
import { EQUIPMENT_NO_WEAPON, MOUNT_NO_RIDER } from "../src/components/core";

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

describe("PREFAB_IDS / getPrefab / isPrefabId", () => {
  it("registers exactly the five first-party prefabs (docs/adr/0015 decision 3; enemy added in H1c, coin-pickup in H1e, mount in I1b)", () => {
    expect([...PREFAB_IDS].sort()).toEqual(["coin-pickup", "enemy", "mount", "npc", "player-start"]);
  });

  it("getPrefab resolves a known id and returns undefined for an unknown one", () => {
    expect(getPrefab("player-start")).toBe(PLAYER_START_PREFAB);
    expect(getPrefab("npc")).toBe(NPC_PREFAB);
    expect(getPrefab("enemy")).toBe(ENEMY_PREFAB);
    expect(getPrefab("coin-pickup")).toBe(COIN_PICKUP_PREFAB);
    expect(getPrefab("mount")).toBe(MOUNT_PREFAB);
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
      width: 20,
      height: 20,
      offsetX: 0,
      offsetY: 0,
      isTrigger: 0,
      layer: 0,
    });
    expect(world.get(entity, "PlayerControlled")).toMatchObject({ inputMapId: 0 });
    expect(world.get(entity, "Animator")).toMatchObject({ clipId: -1, playing: 0, speed: 1, loop: 1, elapsed: 0, facing: 0 });
    // H1e: a real, full Health the HUD health bar reads live.
    expect(world.get(entity, "Health")).toMatchObject({ current: 100, max: 100, invulnerableUntil: 0, flashUntil: 0 });
    // I1c: a real wearer, starting bare-handed.
    expect(world.get(entity, "Equipment")).toMatchObject({ weaponEntity: EQUIPMENT_NO_WEAPON });
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

  it("spawns ENEMY_PREFAB with a real box Collider, Velocity, full Health, and EnemyAi homed on its own spawn point — the I1a combat+AI target shape", () => {
    const world = makeWorld();
    const entity = spawnFromPrefab(world, ENEMY_PREFAB, 50, 60, () => 3);
    world.flush();

    expect(world.get(entity, "Transform")).toMatchObject({ x: 50, y: 60 });
    expect(world.get(entity, "Sprite")).toMatchObject({ assetId: 3, frame: 0 });
    expect(world.get(entity, "Velocity")).toMatchObject({ vx: 0, vy: 0, maxSpeed: 90, friction: 6 });
    expect(world.get(entity, "Collider")).toMatchObject({ shape: 0, width: 24, height: 24, isTrigger: 0 });
    expect(world.get(entity, "Health")).toMatchObject({ current: 30, max: 30, invulnerableUntil: 0, flashUntil: 0 });
    expect(world.get(entity, "EnemyAi")).toMatchObject({ homeX: 50, homeY: 60, wanderTargetX: 50, wanderTargetY: 60, attackCooldownUntil: 0 });
    expect(world.has(entity, "PlayerControlled")).toBe(false);
  });

  it("spawns COIN_PICKUP_PREFAB with a trigger circle Collider and a real Pickup — the H1e item-drop shape", () => {
    const world = makeWorld();
    const entity = spawnFromPrefab(world, COIN_PICKUP_PREFAB, 70, 80, () => 4);
    world.flush();

    expect(world.get(entity, "Transform")).toMatchObject({ x: 70, y: 80 });
    expect(world.get(entity, "Sprite")).toMatchObject({ assetId: 4, frame: 0 });
    expect(world.get(entity, "Collider")).toMatchObject({ shape: 1, width: 16, height: 16, isTrigger: 1 });
    expect(world.get(entity, "Pickup")).toMatchObject({ itemId: COIN_ITEM_ID, amount: 1 });
    expect(world.has(entity, "Health")).toBe(false);
    expect(world.has(entity, "Velocity")).toBe(false);
    expect(world.has(entity, "PlayerControlled")).toBe(false);
  });

  it("spawns MOUNT_PREFAB unridden, with no Collider — the I1b rideable-entity shape", () => {
    const world = makeWorld();
    const entity = spawnFromPrefab(world, MOUNT_PREFAB, 90, 100, () => 5);
    world.flush();

    expect(world.get(entity, "Transform")).toMatchObject({ x: 90, y: 100 });
    expect(world.get(entity, "Sprite")).toMatchObject({ assetId: 5, frame: 0 });
    expect(world.get(entity, "Mount")).toMatchObject({ riderEntity: MOUNT_NO_RIDER, range: 40, mountedMaxSpeed: 260, riderBaseMaxSpeed: 0 });
    expect(world.has(entity, "Collider")).toBe(false);
    expect(world.has(entity, "Health")).toBe(false);
    expect(world.has(entity, "Velocity")).toBe(false);
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
