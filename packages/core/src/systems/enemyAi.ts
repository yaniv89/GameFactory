import { EnemyAiSchema, HealthSchema, TransformSchema, VelocitySchema } from "../components/core";
import type { EventBus } from "../events/eventBus";
import type { EntityId } from "../ecs/entity";
import type { Query } from "../ecs/query";
import type { MeleeAttackEventMap } from "./meleeAttack";
import type { SystemDefinition } from "../scheduler/system";
import type { World } from "../ecs/world";

export interface EnemyAiSystemOptions {
  world: World;
  /** Reuses `createMeleeAttackSystem`'s own event map: a `"combat:hit"` here is indistinguishable in shape from the player's own outgoing swing, so the existing floating-damage-number, hit-flash, and audio-impact reactions (all keyed off `Health`/the event bus, not "who threw the punch") apply to the player getting hit automatically, with no new wiring needed on the render side. */
  events: EventBus<MeleeAttackEventMap>;
  /** World-units radius within which an idle/wandering entity notices the player and starts chasing. */
  detectRadius: number;
  /** World-units distance at which a chasing entity stops and attacks instead of closing further. */
  attackRange: number;
  attackDamage: number;
  attackCooldownSec: number;
  /** The i-frames a landed attack grants the player — same shape `createMeleeAttackSystem`'s own `invulnerabilitySec` already gives an enemy target. */
  attackInvulnerabilitySec: number;
  attackFlashSec: number;
  /** World-units radius an idle entity wanders within, centered on its own `EnemyAi.homeX`/`homeY` (its spawn position). */
  wanderRadius: number;
  wanderSpeed: number;
  /** Within this distance of its own wander target, an entity picks a new one rather than closing the last few units. */
  wanderArriveDistance?: number;
  /**
   * Per-axis walkability check, the same shape and purpose
   * `createPlayerMovementSystem`'s own `isWalkable` parameter already has
   * (editor-preview/player packages) — `@forge/core` has no notion of a
   * tilemap, so this defaults to "everywhere is walkable" (the same
   * "doesn't resolve wall collision" simplification
   * `createKnockbackPhysicsSystem` already states and accepts) unless the
   * caller passes a real one wired to its own live tile data.
   */
  isWalkable?: (worldX: number, worldY: number) => boolean;
}

const DEFAULT_WANDER_ARRIVE_DISTANCE = 4;

function moveToward(
  transform: { x: number; y: number },
  targetX: number,
  targetY: number,
  speed: number,
  dt: number,
  isWalkable: (x: number, y: number) => boolean,
): { x: number; y: number; vx: number; vy: number } {
  const dx = targetX - transform.x;
  const dy = targetY - transform.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 0.001) return { x: transform.x, y: transform.y, vx: 0, vy: 0 };

  const stepX = (dx / dist) * speed * dt;
  const stepY = (dy / dist) * speed * dt;
  let nextX = transform.x;
  let nextY = transform.y;
  // Axis-independent, so a blocked axis doesn't stop the other one — the
  // same "slide along a wall" shape `createPlayerMovementSystem` already
  // uses for the same reason.
  if (stepX !== 0 && isWalkable(transform.x + stepX, transform.y)) nextX = transform.x + stepX;
  if (stepY !== 0 && isWalkable(nextX, transform.y + stepY)) nextY = transform.y + stepY;

  return { x: nextX, y: nextY, vx: dt > 0 ? (nextX - transform.x) / dt : 0, vy: dt > 0 ? (nextY - transform.y) / dt : 0 };
}

/**
 * I1a's enemy behavior for any `[Transform, Velocity, Health, EnemyAi]`
 * entity: idle/wander near its own spawn point, detect and chase the
 * nearest `[Transform, PlayerControlled]` entity within `detectRadius`,
 * and attack (real damage to the player's own `Health`, on a cooldown)
 * once within `attackRange`. An entity still inside its own
 * `Health.invulnerableUntil` window is skipped entirely — that's the
 * hit-stun `createKnockbackPhysicsSystem` is actively driving that same
 * tick, and having both systems fight over the same `Transform`/`Velocity`
 * would double-move the entity, the exact bug `createKnockbackPhysicsSystem`'s
 * own `PlayerControlled` exclusion already exists to prevent for the
 * player; AI stepping aside during its own hit-stun window is this
 * system's side of that same guarantee.
 *
 * Never applies knockback to the player on a landed hit (unlike
 * `createMeleeAttackSystem`'s own outgoing-swing knockback): `createKnockbackPhysicsSystem`
 * deliberately excludes `PlayerControlled` entities, so setting the
 * player's `Velocity` here would just get silently overwritten by
 * `createPlayerMovementSystem` on the very next tick — not a missing
 * feature, an accepted no-op avoided rather than shipped as dead code.
 * Likewise never emits `"combat:death"` for the player: unlike an enemy,
 * a player reaching 0 health has no destroy/respawn/game-over design yet
 * — a stated, honest gap (not a fake one), left for later work. Health is
 * still clamped at 0 and the real damage/hit-flash/floating-number
 * feedback all fire normally.
 */
export function createEnemyAiSystem(options: EnemyAiSystemOptions): SystemDefinition {
  const {
    world,
    events,
    detectRadius,
    attackRange,
    attackDamage,
    attackCooldownSec,
    attackInvulnerabilitySec,
    attackFlashSec,
    wanderRadius,
    wanderSpeed,
    wanderArriveDistance = DEFAULT_WANDER_ARRIVE_DISTANCE,
    isWalkable = () => true,
  } = options;
  const playersQuery = world.query(["Transform", "PlayerControlled"]);

  function findNearestPlayer(fromX: number, fromY: number): { entity: EntityId; x: number; y: number; distance: number } | undefined {
    let nearest: { entity: EntityId; x: number; y: number; distance: number } | undefined;
    playersQuery.forEach((entity) => {
      const transform = world.get<typeof TransformSchema>(entity, "Transform");
      if (!transform) return;
      const distance = Math.hypot(transform.x - fromX, transform.y - fromY);
      if (!nearest || distance < nearest.distance) nearest = { entity, x: transform.x, y: transform.y, distance };
    });
    return nearest;
  }

  return {
    id: "core:EnemyAi",
    phase: "PostUpdate",
    before: ["core:CharacterAnimation"],
    query: ["Transform", "Velocity", "Health", "EnemyAi"],
    run: (ctx, entities: Query) => {
      entities.forEach((entity) => {
        const transform = world.get<typeof TransformSchema>(entity, "Transform");
        const health = world.get<typeof HealthSchema>(entity, "Health");
        const ai = world.get<typeof EnemyAiSchema>(entity, "EnemyAi");
        if (!transform || !health || !ai) return;
        if (ctx.elapsed < health.invulnerableUntil) return; // hit-stunned — createKnockbackPhysicsSystem owns this entity right now.

        const player = findNearestPlayer(transform.x, transform.y);

        if (player && player.distance <= attackRange) {
          world.set(entity, "Velocity", { vx: 0, vy: 0 });
          if (ctx.elapsed >= ai.attackCooldownUntil) {
            const playerHealth = world.get<typeof HealthSchema>(player.entity, "Health");
            if (playerHealth && ctx.elapsed >= playerHealth.invulnerableUntil) {
              const remaining = Math.max(0, playerHealth.current - attackDamage);
              world.set(player.entity, "Health", {
                current: remaining,
                invulnerableUntil: ctx.elapsed + attackInvulnerabilitySec,
                flashUntil: ctx.elapsed + attackFlashSec,
              });
              events.emit("combat:hit", { attacker: entity, target: player.entity, damage: attackDamage, targetHealthRemaining: remaining });
              world.set(entity, "EnemyAi", { attackCooldownUntil: ctx.elapsed + attackCooldownSec });
            }
          }
          return;
        }

        if (player && player.distance <= detectRadius) {
          const moved = moveToward(transform, player.x, player.y, world.get<typeof VelocitySchema>(entity, "Velocity")!.maxSpeed, ctx.dt, isWalkable);
          world.set(entity, "Transform", { x: moved.x, y: moved.y });
          world.set(entity, "Velocity", { vx: moved.vx, vy: moved.vy });
          return;
        }

        // Idle/wander: amble toward a random point near home, picking a new one on arrival.
        const distanceToWanderTarget = Math.hypot(ai.wanderTargetX - transform.x, ai.wanderTargetY - transform.y);
        if (distanceToWanderTarget <= wanderArriveDistance) {
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * wanderRadius;
          world.set(entity, "EnemyAi", { wanderTargetX: ai.homeX + Math.cos(angle) * radius, wanderTargetY: ai.homeY + Math.sin(angle) * radius });
          world.set(entity, "Velocity", { vx: 0, vy: 0 });
          return;
        }
        const moved = moveToward(transform, ai.wanderTargetX, ai.wanderTargetY, wanderSpeed, ctx.dt, isWalkable);
        world.set(entity, "Transform", { x: moved.x, y: moved.y });
        world.set(entity, "Velocity", { vx: moved.vx, vy: moved.vy });
      });
    },
  };
}
