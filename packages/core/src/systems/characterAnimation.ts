import { AnimatorSchema, SpriteSchema, VelocitySchema } from "../components/core";
import type { Query } from "../ecs/query";
import type { SystemDefinition } from "../scheduler/system";
import type { World } from "../ecs/world";

/** Row index into a directional character sheet — matches the row convention every generated/authored character sheet in this repo follows (south is the sheet's first row, reading top to bottom). */
export const FACING_SOUTH = 0;
export const FACING_WEST = 1;
export const FACING_EAST = 2;
export const FACING_NORTH = 3;

export interface CharacterAnimationSystemOptions {
  world: World;
  /** Frames per animation row (the walk cycle's column count) — every character sheet this system drives shares one fixed grid, per docs/adr/0014's `characters.template.animations.walk`. */
  frameCount: number;
  /** Walk-cycle playback rate, frames per second. */
  fps: number;
  /**
   * Velocity magnitude (world units/sec) below which an entity is treated
   * as stopped rather than walking-in-place — guards against floating-point
   * residue from collision-blocked movement (`createPlayerMovementSystem`
   * can leave a sub-pixel `vx`/`vy` when a diagonal move is partially
   * blocked) registering as motion.
   */
  movingThreshold?: number;
}

/**
 * Drives `Sprite.frame` from `Velocity` for any entity carrying
 * `[Sprite, Animator, Velocity]` — the row (`Animator.facing`) picks a
 * direction from the dominant movement axis and holds it while idle; the
 * column cycles through `frameCount` frames at `fps` while moving and
 * parks on frame 0 (the walk cycle's idle pose, per `gensprite_h1.py`'s
 * `LEG_CYCLE`) once stopped. An entity with no `Velocity` (a static NPC)
 * never matches this system's query and simply keeps whatever `Sprite.frame`
 * its prefab set — exactly the "standing still" pose that's frame 0 of row
 * 0 by every prefab's own default.
 */
export function createCharacterAnimationSystem(options: CharacterAnimationSystemOptions): SystemDefinition {
  const { world, frameCount, fps, movingThreshold = 2 } = options;
  const cycleDurationSec = frameCount / fps;

  return {
    id: "core:CharacterAnimation",
    phase: "PostUpdate",
    query: ["Sprite", "Animator", "Velocity"],
    run: (ctx, entities: Query) => {
      entities.forEach((entity) => {
        const velocity = world.get<typeof VelocitySchema>(entity, "Velocity");
        const animator = world.get<typeof AnimatorSchema>(entity, "Animator");
        if (!velocity || !animator) return;

        const speed = Math.hypot(velocity.vx, velocity.vy);
        const moving = speed >= movingThreshold;

        let facing = animator.facing;
        if (moving) {
          facing = Math.abs(velocity.vx) >= Math.abs(velocity.vy) ? (velocity.vx < 0 ? FACING_WEST : FACING_EAST) : velocity.vy < 0 ? FACING_NORTH : FACING_SOUTH;
        }

        const elapsed = moving ? (animator.elapsed + ctx.dt) % cycleDurationSec : 0;
        const frameInRow = moving ? Math.floor((elapsed / cycleDurationSec) * frameCount) % frameCount : 0;

        world.set(entity, "Animator", { facing, elapsed, playing: moving ? 1 : 0 });
        world.set(entity, "Sprite", { frame: facing * frameCount + frameInRow });
      });
    },
  };
}
