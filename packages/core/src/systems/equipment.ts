import { AnimatorSchema, EQUIPMENT_NO_WEAPON, EquipmentSchema, TransformSchema } from "../components/core";
import { facingToOffset } from "./characterAnimation";
import type { Query } from "../ecs/query";
import type { SystemDefinition } from "../scheduler/system";
import type { World } from "../ecs/world";

export interface EquipmentSystemOptions {
  world: World;
  /** True exactly once per "toggle equip" input, edge-detected by the caller — the same "own the input state" split `createMeleeAttackSystem`'s `consumeAttackRequest` already establishes. */
  consumeEquipRequest: () => boolean;
  /** Pre-resolved numeric `Sprite.assetId` for the wielded-weapon visual — `@forge/core` has no notion of sprite-key resolution (docs/adr/0015 decision 4), so the caller resolves it ahead of time, the same way `ENEMY_ASSET_ID` etc. are already plain numeric constants in the editor preview. */
  weaponAssetId: number;
  /** World-units distance the weapon visual renders in front of the wearer, along `Animator.facing`. */
  weaponOffset: number;
}

/**
 * I1c's equip/unequip toggle for any `[Transform, Animator, Equipment]`
 * entity, on a single edge-triggered request (the caller decides what
 * input that is — the editor preview binds a dedicated key, since "E" is
 * already spoken for by NPC dialogue and mount/dismount).
 *
 * Toggling creates (or destroys) a real, standalone weapon-visual entity
 * — not a sprite-frame swap on the wearer itself, since the weapon needs
 * its own `Transform` (a position offset and rotation independent of the
 * wearer's own facing-driven walk-cycle frame). While equipped, that
 * entity's `Transform` is re-synced to the wearer's current position and
 * facing *every* tick, unlike `createMountSystem`'s own deliberately
 * lazy "only reposition at dismount" simplification — a mount is hidden
 * while ridden, but a wielded weapon is visibly worn, so it has to track
 * the wearer's movement in real time.
 *
 * Equipping affects only this visual — `createMeleeAttackSystem` itself
 * is not gated on `Equipment` (see that component's own doc comment for
 * why this is a stated scope boundary, not an oversight).
 */
export function createEquipmentSystem(options: EquipmentSystemOptions): SystemDefinition {
  const { world, consumeEquipRequest, weaponAssetId, weaponOffset } = options;

  return {
    id: "core:Equipment",
    phase: "PostUpdate",
    query: ["Transform", "Animator", "Equipment"],
    run: (_ctx, wearers: Query) => {
      const toggled = consumeEquipRequest();

      wearers.forEach((wearer) => {
        const transform = world.get<typeof TransformSchema>(wearer, "Transform");
        const animator = world.get<typeof AnimatorSchema>(wearer, "Animator");
        const equipment = world.get<typeof EquipmentSchema>(wearer, "Equipment");
        if (!transform || !animator || !equipment) return;

        const offset = facingToOffset(animator.facing);
        const weaponX = transform.x + offset.x * weaponOffset;
        const weaponY = transform.y + offset.y * weaponOffset;
        const weaponRotation = Math.atan2(offset.y, offset.x);

        let weaponEntity = equipment.weaponEntity;
        let justCreated = false;

        if (toggled) {
          if (weaponEntity !== EQUIPMENT_NO_WEAPON) {
            world.destroy(weaponEntity);
            weaponEntity = EQUIPMENT_NO_WEAPON;
          } else {
            // The full initial Transform is supplied here, not via a
            // follow-up world.set: create/destroy are deferred to the
            // scheduler's own end-of-phase flush() (World.create's own doc
            // comment), so a just-created entity isn't queryable/settable
            // until then — the same pitfall PreviewApp.tsx's own demo-enemy
            // boot sequence hit and documents.
            weaponEntity = world.create({
              Transform: { x: weaponX, y: weaponY, z: 0, rotation: weaponRotation, scaleX: 1, scaleY: 1 },
              Sprite: { assetId: weaponAssetId, frame: 0, anchorX: 0.5, anchorY: 0.5, tint: 0xffffff, opacity: 1 },
            });
            justCreated = true;
          }
          world.set(wearer, "Equipment", { weaponEntity });
        }

        if (weaponEntity !== EQUIPMENT_NO_WEAPON && !justCreated) {
          world.set(weaponEntity, "Transform", { x: weaponX, y: weaponY, rotation: weaponRotation });
        }
      });
    },
  };
}
