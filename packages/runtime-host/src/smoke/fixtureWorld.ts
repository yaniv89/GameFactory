import { registerCoreComponents, World } from "@forge/core";

/**
 * docs/SPEC.md Section 10.4 gate 4: "run 600 ticks against a fixture
 * project." `fixtures/projects/` has no golden-file project checked in yet
 * (M3's own note, still true here), so this builds a small, representative
 * scene in code instead — the same core components
 * (`@forge/core`'s `registerCoreComponents`) a real topdown-rpg scene
 * registers, with a player-controlled entity plus a handful of static,
 * collidable ones, so a module's systems have realistic component data to
 * query and mutate for the run. Not a substitute for a real fixture
 * project once one exists — swap this out then, not before.
 */
export function buildSmokeFixtureWorld(): World {
  const world = new World();
  registerCoreComponents(world);

  world.create({
    Transform: { x: 0, y: 0, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
    Sprite: { assetId: 0, frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 },
    Velocity: { vx: 0, vy: 0, maxSpeed: 120, friction: 0.1 },
    PlayerControlled: { inputMapId: 0 },
  });

  for (let i = 0; i < 8; i++) {
    world.create({
      Transform: { x: (i + 1) * 32, y: 64, z: 0, rotation: 0, scaleX: 1, scaleY: 1 },
      Sprite: { assetId: 1, frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 },
      Collider: { shape: 0, width: 32, height: 32, offsetX: 0, offsetY: 0, isTrigger: 0, layer: 0 },
    });
  }

  world.flush();
  return world;
}
