import { MOUNT_NO_RIDER, MountSchema, TransformSchema, VelocitySchema } from "../components/core";
import type { EntityId } from "../ecs/entity";
import type { Query } from "../ecs/query";
import type { SystemDefinition } from "../scheduler/system";
import type { World } from "../ecs/world";

export interface MountSystemOptions {
  world: World;
  /** True exactly once per "try mount/dismount" input, edge-detected by the caller — the same "own the input state" split `createMeleeAttackSystem`'s `consumeAttackRequest` already establishes. */
  consumeMountRequest: () => boolean;
}

/**
 * I1b's mount/dismount toggle for any `[Transform, Velocity, PlayerControlled]`
 * entity against any `[Transform, Sprite, Mount]` entity, on a single
 * edge-triggered request (the caller decides what input that is — the
 * editor preview reuses its own "E" interact key, falling back to this
 * once no NPC dialogue target is in range).
 *
 * A rider already mounted on *something* always dismounts on the next
 * request, regardless of distance — there is no "walk away while mounted"
 * unmount, matching how a player would actually expect the same key to
 * toggle. An unmounted rider instead mounts the *nearest* unridden `Mount`
 * entity within that entity's own `Mount.range`, if any.
 *
 * Mounting swaps the rider's `Velocity.maxSpeed` to the mount's
 * `mountedMaxSpeed` and hides the mount's own sprite (`Sprite.opacity: 0`)
 * — the rider is the only thing visibly moving from here, the same
 * "no composite rider+mount art yet, an honest placeholder" reasoning
 * `DEATH_BURST_COLOR`'s own doc comment (PreviewApp.tsx) already accepts
 * for procedural flourishes ahead of real art. The mount's own `Transform`
 * is deliberately left wherever it was at mount time — it's invisible
 * while ridden, so per-tick tracking would be pure wasted work — and is
 * snapped to the rider's current position only at dismount, so it
 * reappears exactly where the ride ended, not where it began.
 */
export function createMountSystem(options: MountSystemOptions): SystemDefinition {
  const { world, consumeMountRequest } = options;
  const mountsQuery = world.query(["Transform", "Sprite", "Mount"]);

  return {
    id: "core:Mount",
    phase: "PostUpdate",
    query: ["Transform", "Velocity", "PlayerControlled"],
    run: (_ctx, riders: Query) => {
      if (!consumeMountRequest()) return;

      riders.forEach((rider) => {
        const riderTransform = world.get<typeof TransformSchema>(rider, "Transform");
        const riderVelocity = world.get<typeof VelocitySchema>(rider, "Velocity");
        if (!riderTransform || !riderVelocity) return;

        let currentMount: EntityId | undefined;
        mountsQuery.forEach((mountEntity) => {
          if (currentMount !== undefined) return;
          const mount = world.get<typeof MountSchema>(mountEntity, "Mount");
          if (mount && mount.riderEntity === rider) currentMount = mountEntity;
        });

        if (currentMount !== undefined) {
          const mount = world.get<typeof MountSchema>(currentMount, "Mount")!;
          world.set(rider, "Velocity", { maxSpeed: mount.riderBaseMaxSpeed });
          world.set(currentMount, "Transform", { x: riderTransform.x, y: riderTransform.y });
          world.set(currentMount, "Sprite", { opacity: 1 });
          world.set(currentMount, "Mount", { riderEntity: MOUNT_NO_RIDER });
          return;
        }

        let nearest: { entity: EntityId; distance: number; mountedMaxSpeed: number } | undefined;
        mountsQuery.forEach((mountEntity) => {
          const mount = world.get<typeof MountSchema>(mountEntity, "Mount");
          const transform = world.get<typeof TransformSchema>(mountEntity, "Transform");
          if (!mount || !transform) return;
          if (mount.riderEntity !== MOUNT_NO_RIDER) return;
          const distance = Math.hypot(transform.x - riderTransform.x, transform.y - riderTransform.y);
          if (distance > mount.range) return;
          if (!nearest || distance < nearest.distance) nearest = { entity: mountEntity, distance, mountedMaxSpeed: mount.mountedMaxSpeed };
        });
        if (!nearest) return;

        world.set(nearest.entity, "Mount", { riderEntity: rider, riderBaseMaxSpeed: riderVelocity.maxSpeed });
        world.set(nearest.entity, "Sprite", { opacity: 0 });
        world.set(rider, "Velocity", { maxSpeed: nearest.mountedMaxSpeed });
      });
    },
  };
}
