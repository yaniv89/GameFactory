import type { EntityId, ForgeModule, SetupContext } from "@forge/module-api";
import {
  ACTIVE_BATTLE_STORAGE_KEY,
  COMBATANT_COMPONENT,
  DEFAULT_HIT_CHANCE,
  type ActiveBattleState,
  type AttackEvent,
  type BattleEndedEvent,
  type CombatantShape,
  type DamageAppliedEvent,
  type DefeatedEvent,
  type MissedEvent,
  type StartBattleEvent,
  type TurnStartedEvent,
} from "./types";

export * from "./types";

/**
 * @forge/turn-battle — 1v1 turn-based combat, built entirely against
 * @forge/module-api. `combat:damage` and `combat:hitChance`
 * (`InterceptorMap`) are triggered via `ctx.runInterceptor` (docs/adr/0006)
 * for every attack, so a status-effects or difficulty module can adjust
 * the numbers without patching this module — same WordPress-filter
 * pattern `@forge/dialogue` and `@forge/inventory` use for their own
 * owned points. Battle participants/turn order are `storage`-backed, not
 * an ECS component (a two-entity list doesn't fit a fixed numeric field
 * schema); `Combatant`'s hp/atk/def *are* real ECS component fields.
 */
export const turnBattleModule: ForgeModule = {
  setup(ctx: SetupContext): void {
    ctx.defineComponent<CombatantShape>(
      COMBATANT_COMPONENT,
      {
        hp: { type: "number" },
        maxHp: { type: "number" },
        atk: { type: "number" },
        def: { type: "number" },
        alive: { type: "boolean" },
      },
      { hp: 10, maxHp: 10, atk: 1, def: 0, alive: true },
    );

    function activeBattle(): ActiveBattleState | undefined {
      return ctx.storage.get<ActiveBattleState>(ACTIVE_BATTLE_STORAGE_KEY) ?? undefined;
    }

    ctx.events.on("battle:start", (payload) => {
      const { a, b } = payload as StartBattleEvent;
      const statsA = ctx.world.get<CombatantShape>(a, COMBATANT_COMPONENT);
      const statsB = ctx.world.get<CombatantShape>(b, COMBATANT_COMPONENT);
      if (!statsA || !statsB) {
        ctx.log.error("battle:start requires both entities to carry Combatant", { a, b });
        return;
      }
      if (!statsA.alive || !statsB.alive) {
        ctx.log.error("battle:start requires both entities to be alive", { a, b });
        return;
      }
      const state: ActiveBattleState = { a, b, turn: a };
      ctx.storage.set(ACTIVE_BATTLE_STORAGE_KEY, state);
      ctx.events.emit("battle:turnStarted", { entity: a } satisfies TurnStartedEvent);
    });

    ctx.events.on("battle:attack", (payload) => {
      const { attacker } = payload as AttackEvent;
      const battle = activeBattle();
      if (!battle) {
        ctx.log.warn("battle:attack received with no active battle");
        return;
      }
      if (battle.turn !== attacker) {
        ctx.log.warn("battle:attack received out of turn", { attacker, expected: battle.turn });
        return;
      }
      const target = attacker === battle.a ? battle.b : battle.a;
      const attackerStats = ctx.world.get<CombatantShape>(attacker, COMBATANT_COMPONENT);
      const targetStats = ctx.world.get<CombatantShape>(target, COMBATANT_COMPONENT);
      if (!attackerStats || !targetStats) {
        ctx.log.error("battle:attack: a participant no longer carries Combatant", { attacker, target });
        return;
      }

      const hitChance = ctx.runInterceptor("combat:hitChance", { attacker, target, chance: DEFAULT_HIT_CHANCE });
      if (Math.random() >= hitChance.chance) {
        ctx.events.emit("battle:missed", { attacker, target } satisfies MissedEvent);
        advanceTurn(battle, target);
        return;
      }

      const damage = ctx.runInterceptor("combat:damage", {
        attacker,
        target,
        amount: Math.max(0, attackerStats.atk - targetStats.def),
        type: "physical",
      });
      const remainingHp = Math.max(0, targetStats.hp - damage.amount);
      ctx.world.set<CombatantShape>(target, COMBATANT_COMPONENT, { hp: remainingHp, alive: remainingHp > 0 });
      ctx.events.emit("battle:damageApplied", { attacker, target, amount: damage.amount, remainingHp } satisfies DamageAppliedEvent);

      if (remainingHp <= 0) {
        ctx.events.emit("battle:defeated", { entity: target } satisfies DefeatedEvent);
        ctx.events.emit("battle:ended", { winner: attacker, loser: target } satisfies BattleEndedEvent);
        ctx.storage.delete(ACTIVE_BATTLE_STORAGE_KEY);
        return;
      }

      advanceTurn(battle, target);
    });

    function advanceTurn(battle: ActiveBattleState, next: EntityId): void {
      ctx.storage.set(ACTIVE_BATTLE_STORAGE_KEY, { ...battle, turn: next } satisfies ActiveBattleState);
      ctx.events.emit("battle:turnStarted", { entity: next } satisfies TurnStartedEvent);
    }
  },
};

export default turnBattleModule;
