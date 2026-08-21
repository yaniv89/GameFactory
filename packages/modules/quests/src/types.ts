import type { EntityId } from "@forge/module-api";

/**
 * A component's field schema is fixed at `defineComponent` time and is
 * number/boolean only (docs/SPEC.md Section 4.2) — a quest's objective
 * count is author-defined data, not a runtime-variable count this module
 * could resize a schema around. `MAX_OBJECTIVES_PER_QUEST` is the same
 * kind of structural cap `core:repeat`'s own ceiling applies to a
 * runtime-variable count (`packages/modules/graph-nodes-core/src/nodes/flow.ts`):
 * every `Quest_<id>` component is defined with exactly this many `objN`
 * boolean fields, always, regardless of how many objectives a specific
 * quest actually declares — unused slots simply stay `false` and are
 * never read.
 */
export const MAX_OBJECTIVES_PER_QUEST = 16;

export interface QuestObjectiveConfig {
  readonly id: string;
  readonly description: string;
}

export interface QuestDefinitionConfig {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly objectives: readonly QuestObjectiveConfig[];
}

/** Shape of `SetupContext.config` this module expects (docs/SPEC.md Section 9.2's `configSchema`, validated at install time by the registry — out of scope for this module itself). */
export interface QuestsModuleConfig {
  readonly quests?: readonly QuestDefinitionConfig[];
}

/**
 * The `Quest_<questId>` component's field shape — one component type per
 * author-defined quest (docs/adr/0018 Decision 1), registered once per
 * quest from `config.quests` at `setup()` time. `obj0..obj{N-1}` track
 * completion of `objectives[0..N-1]` by array index; indices beyond a
 * given quest's own `objectives.length` are simply never set.
 */
export interface QuestStateShape extends Record<string, number | boolean> {
  active: boolean;
  completed: boolean;
  obj0: boolean;
  obj1: boolean;
  obj2: boolean;
  obj3: boolean;
  obj4: boolean;
  obj5: boolean;
  obj6: boolean;
  obj7: boolean;
  obj8: boolean;
  obj9: boolean;
  obj10: boolean;
  obj11: boolean;
  obj12: boolean;
  obj13: boolean;
  obj14: boolean;
  obj15: boolean;
}

export const QUEST_STATE_DEFAULTS: QuestStateShape = {
  active: false,
  completed: false,
  obj0: false,
  obj1: false,
  obj2: false,
  obj3: false,
  obj4: false,
  obj5: false,
  obj6: false,
  obj7: false,
  obj8: false,
  obj9: false,
  obj10: false,
  obj11: false,
  obj12: false,
  obj13: false,
  obj14: false,
  obj15: false,
};

export function questComponentName(questId: string): string {
  return `Quest_${questId}`;
}

export function objectiveFieldName(index: number): keyof QuestStateShape {
  return `obj${index}` as keyof QuestStateShape;
}

export interface StartQuestEvent {
  readonly entity: EntityId;
  readonly questId: string;
}
export interface CompleteObjectiveEvent {
  readonly entity: EntityId;
  readonly questId: string;
  readonly objectiveId: string;
}
export interface QuestStartedEvent {
  readonly entity: EntityId;
  readonly questId: string;
}
export interface ObjectiveCompletedEvent {
  readonly entity: EntityId;
  readonly questId: string;
  readonly objectiveId: string;
}
export interface QuestCompletedEvent {
  readonly entity: EntityId;
  readonly questId: string;
}
export interface QuestRejectedEvent {
  readonly entity: EntityId;
  readonly questId: string;
  readonly reason: "unknownQuest" | "alreadyActive" | "alreadyCompleted" | "unknownObjective" | "notActive";
}
export interface QueryQuestEvent {
  readonly entity: EntityId;
  readonly questId: string;
}
export interface QuestQueriedEvent {
  readonly entity: EntityId;
  readonly questId: string;
  /** `false` for both an inactive and an unknown quest id — an unknown quest simply never had state to be active. */
  readonly active: boolean;
  readonly completed: boolean;
  readonly completedObjectiveIds: readonly string[];
}
