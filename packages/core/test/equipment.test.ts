import { describe, expect, it } from "vitest";
import { EQUIPMENT_NO_WEAPON, registerCoreComponents } from "../src/components/core";
import { createEquipmentSystem } from "../src/systems/equipment";
import { FACING_EAST, FACING_NORTH, FACING_SOUTH } from "../src/systems/characterAnimation";
import { FIXED_STEP_MS } from "../src/scheduler/phase";
import { Scheduler } from "../src/scheduler/scheduler";
import { World } from "../src/ecs/world";

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

function spawnWearer(world: World, x: number, y: number, facing = FACING_SOUTH) {
  const entity = world.create({
    Transform: { x, y },
    Animator: { clipId: -1, playing: 0, speed: 1, loop: 1, elapsed: 0, facing },
    Equipment: { weaponEntity: EQUIPMENT_NO_WEAPON },
  });
  world.flush();
  return entity;
}

const WEAPON_ASSET_ID = 6;
const WEAPON_OFFSET = 18;

function makeRequester(request: boolean) {
  let pending = request;
  return () => {
    const value = pending;
    pending = false;
    return value;
  };
}

describe("createEquipmentSystem", () => {
  it("equips on the first request: creates a real weapon entity positioned in front of the wearer, along its facing", () => {
    const world = makeWorld();
    const wearer = spawnWearer(world, 100, 100, FACING_EAST);

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createEquipmentSystem({ world, consumeEquipRequest: makeRequester(true), weaponAssetId: WEAPON_ASSET_ID, weaponOffset: WEAPON_OFFSET }));
    scheduler.tick(FIXED_STEP_MS);

    const equipment = world.get(wearer, "Equipment")!;
    expect(equipment.weaponEntity).not.toBe(EQUIPMENT_NO_WEAPON);
    const weaponEntity = equipment.weaponEntity!;
    const transform = world.get(weaponEntity, "Transform")!;
    expect(transform.x).toBeCloseTo(100 + WEAPON_OFFSET, 5); // east: +x
    expect(transform.y).toBeCloseTo(100, 5);
    const sprite = world.get(weaponEntity, "Sprite")!;
    expect(sprite.assetId).toBe(WEAPON_ASSET_ID);
  });

  it("does nothing at all without a fresh request", () => {
    const world = makeWorld();
    const wearer = spawnWearer(world, 0, 0);

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createEquipmentSystem({ world, consumeEquipRequest: () => false, weaponAssetId: WEAPON_ASSET_ID, weaponOffset: WEAPON_OFFSET }));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(wearer, "Equipment")).toMatchObject({ weaponEntity: EQUIPMENT_NO_WEAPON });
  });

  it("tracks the wearer's position and facing every tick while equipped, not just at the moment of equipping", () => {
    const world = makeWorld();
    const wearer = spawnWearer(world, 0, 0, FACING_SOUTH);

    let requested = true;
    const scheduler = new Scheduler(world);
    scheduler.addSystem(
      createEquipmentSystem({
        world,
        consumeEquipRequest: () => {
          const value = requested;
          requested = false;
          return value;
        },
        weaponAssetId: WEAPON_ASSET_ID,
        weaponOffset: WEAPON_OFFSET,
      }),
    );
    scheduler.tick(FIXED_STEP_MS); // equip

    const weaponEntity = world.get(wearer, "Equipment")!.weaponEntity!;
    // The wearer walks (some other system's job — simulated here directly)
    // and turns to face north.
    world.set(wearer, "Transform", { x: 50, y: -20 });
    world.set(wearer, "Animator", { facing: FACING_NORTH });
    world.flush();

    scheduler.tick(FIXED_STEP_MS); // no fresh request — pure tracking tick

    const transform = world.get(weaponEntity, "Transform")!;
    expect(transform.x).toBeCloseTo(50, 5);
    expect(transform.y).toBeCloseTo(-20 - WEAPON_OFFSET, 5); // north: -y
  });

  it("unequips on the second request from anywhere: destroys the weapon entity and clears Equipment", () => {
    const world = makeWorld();
    const wearer = spawnWearer(world, 0, 0);

    let requested = true;
    const scheduler = new Scheduler(world);
    scheduler.addSystem(
      createEquipmentSystem({
        world,
        consumeEquipRequest: () => {
          const value = requested;
          requested = false;
          return value;
        },
        weaponAssetId: WEAPON_ASSET_ID,
        weaponOffset: WEAPON_OFFSET,
      }),
    );
    scheduler.tick(FIXED_STEP_MS); // equip
    const weaponEntity = world.get(wearer, "Equipment")!.weaponEntity!;
    expect(world.isAlive(weaponEntity)).toBe(true);

    requested = true;
    scheduler.tick(FIXED_STEP_MS); // unequip

    expect(world.get(wearer, "Equipment")).toMatchObject({ weaponEntity: EQUIPMENT_NO_WEAPON });
    expect(world.isAlive(weaponEntity)).toBe(false);
  });

  it("consumes the request exactly once per edge, not once per wearer", () => {
    const world = makeWorld();
    spawnWearer(world, 0, 0);
    spawnWearer(world, 500, 500);

    let calls = 0;
    const scheduler = new Scheduler(world);
    scheduler.addSystem(
      createEquipmentSystem({
        world,
        consumeEquipRequest: () => {
          calls++;
          return true;
        },
        weaponAssetId: WEAPON_ASSET_ID,
        weaponOffset: WEAPON_OFFSET,
      }),
    );
    scheduler.tick(FIXED_STEP_MS);

    expect(calls).toBe(1);
  });
});
