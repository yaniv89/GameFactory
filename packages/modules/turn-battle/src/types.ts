import type { EntityId } from "@forge/module-api";

export const COMBATANT_COMPONENT = "Combatant";
export const DEFAULT_HIT_CHANCE = 0.9;
export const ACTIVE_BATTLE_STORAGE_KEY = "battle:active";

/** Shape of `SetupContext.config` this module expects (docs/SPEC.md Section 9.2's `configSchema`, validated at install time by the registry — out of scope for this module itself). */
export interface TurnBattleModuleConfig {
  /** Base hit chance before `combat:hitChance` interceptors run. Defaults to `DEFAULT_HIT_CHANCE`. */
  readonly baseHitChance?: number;
}

/** ECS component: one entity's combat stats. */
export interface CombatantShape extends Record<string, number | boolean> {
  hp: number;
  maxHp: number;
  atk: number;
  def: number;
  alive: boolean;
}

/** 1v1 only in v1 — a real free-for-all/team battle is a larger design not required to prove the Module API surface (docs/adr/0006's exercise). Persisted via `storage`, not an ECS component: "who's in this battle" is a list, not a fixed numeric field set. */
export interface ActiveBattleState {
  readonly a: EntityId;
  readonly b: EntityId;
  /** Whose turn it currently is. */
  readonly turn: EntityId;
}

export interface StartBattleEvent {
  readonly a: EntityId;
  readonly b: EntityId;
}
export interface AttackEvent {
  readonly attacker: EntityId;
}
export interface MissedEvent {
  readonly attacker: EntityId;
  readonly target: EntityId;
}
export interface DamageAppliedEvent {
  readonly attacker: EntityId;
  readonly target: EntityId;
  readonly amount: number;
  readonly remainingHp: number;
}
export interface TurnStartedEvent {
  readonly entity: EntityId;
}
export interface DefeatedEvent {
  readonly entity: EntityId;
}
export interface BattleEndedEvent {
  readonly winner: EntityId;
  readonly loser: EntityId;
}
