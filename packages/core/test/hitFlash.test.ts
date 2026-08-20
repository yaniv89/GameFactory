import { describe, expect, it } from "vitest";
import { registerCoreComponents } from "../src/components/core";
import { createHitFlashSystem } from "../src/systems/hitFlash";
import { FIXED_STEP_MS } from "../src/scheduler/phase";
import { Scheduler } from "../src/scheduler/scheduler";
import { World } from "../src/ecs/world";

const FLASH_TINT = 0xff5050;
const NORMAL_TINT = 0xffffff;

function makeWorld() {
  const world = new World();
  registerCoreComponents(world);
  return world;
}

describe("createHitFlashSystem", () => {
  it("leaves an untouched entity's Sprite.tint at the normal color", () => {
    const world = makeWorld();
    const entity = world.create({ Transform: { x: 0, y: 0 }, Sprite: { tint: NORMAL_TINT }, Health: { current: 30, max: 30 } });
    world.flush();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createHitFlashSystem({ world, flashTint: FLASH_TINT, normalTint: NORMAL_TINT }));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(entity, "Sprite")).toMatchObject({ tint: NORMAL_TINT });
  });

  it("tints an entity while elapsed is inside its own flashUntil window, then reverts once it passes", () => {
    const world = makeWorld();
    const entity = world.create({
      Transform: { x: 0, y: 0 },
      Sprite: { tint: NORMAL_TINT },
      Health: { current: 20, max: 30, flashUntil: 0.15 },
    });
    world.flush();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createHitFlashSystem({ world, flashTint: FLASH_TINT, normalTint: NORMAL_TINT }));

    scheduler.tick(FIXED_STEP_MS); // elapsed well under 0.15s
    expect(world.get(entity, "Sprite")).toMatchObject({ tint: FLASH_TINT });

    for (let i = 0; i < 30; i++) scheduler.tick(FIXED_STEP_MS); // ~0.5s total — past the flash window
    expect(world.get(entity, "Sprite")).toMatchObject({ tint: NORMAL_TINT });
  });

  it("does not touch an entity with no Health component (e.g. an NPC or the player)", () => {
    const world = makeWorld();
    const entity = world.create({ Transform: { x: 0, y: 0 }, Sprite: { tint: 0x123456 } });
    world.flush();

    const scheduler = new Scheduler(world);
    scheduler.addSystem(createHitFlashSystem({ world }));
    scheduler.tick(FIXED_STEP_MS);

    expect(world.get(entity, "Sprite")).toMatchObject({ tint: 0x123456 });
  });
});
