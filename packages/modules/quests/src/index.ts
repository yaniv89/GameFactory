import type { EntityId, ForgeModule, SetupContext } from "@forge/module-api";
import {
  MAX_OBJECTIVES_PER_QUEST,
  QUEST_STATE_DEFAULTS,
  objectiveFieldName,
  questComponentName,
  type CompleteObjectiveEvent,
  type ObjectiveCompletedEvent,
  type QueryQuestEvent,
  type QuestCompletedEvent,
  type QuestDefinitionConfig,
  type QuestQueriedEvent,
  type QuestRejectedEvent,
  type QuestStartedEvent,
  type QuestStateShape,
  type QuestsModuleConfig,
  type StartQuestEvent,
} from "./types";

export * from "./types";

function validateQuests(ctx: SetupContext): readonly QuestDefinitionConfig[] {
  const raw = (ctx.config as QuestsModuleConfig).quests;
  if (!Array.isArray(raw)) return [];
  const valid: QuestDefinitionConfig[] = [];
  for (const quest of raw) {
    if (typeof quest?.id !== "string" || typeof quest.name !== "string" || !Array.isArray(quest.objectives)) {
      ctx.log.warn("quests: skipping a malformed quest in config.quests (needs a string id, a string name, and an objectives array)", { quest });
      continue;
    }
    if (quest.objectives.length > MAX_OBJECTIVES_PER_QUEST) {
      ctx.log.warn(`quests: quest "${quest.id}" declares more than ${MAX_OBJECTIVES_PER_QUEST} objectives; extras are truncated and can never be completed`, {
        questId: quest.id,
        declared: quest.objectives.length,
        max: MAX_OBJECTIVES_PER_QUEST,
      });
    }
    valid.push({ ...quest, objectives: quest.objectives.slice(0, MAX_OBJECTIVES_PER_QUEST) });
  }
  return valid;
}

/**
 * @forge/quests — durable, event-driven quest progress, built entirely
 * against @forge/module-api (docs/adr/0018 Decision 1). The actual quest
 * *logic* (when an objective completes, what happens on completion) is
 * deliberately not this module's job — it lives in an ordinary graph
 * authored against `core:questStart`/`core:questCompleteObjective`/
 * `core:questIsActive`/`core:questIsObjectiveComplete`
 * (`@forge/graph-nodes-core`), which call into this module's own event
 * surface (`quest:start`/`quest:completeObjective`/`quest:query`) the
 * same way a hand-written module would. This module only owns state:
 * one `Quest_<id>` component per author-defined quest (registered from
 * `config.quests` at setup time — a project's quest set is fixed at
 * export time, not runtime-variable), persisted the same way any other
 * ECS component snapshot already is.
 */
export const questsModule: ForgeModule = {
  setup(ctx: SetupContext): void {
    const quests = validateQuests(ctx);
    const questsById = new Map<string, QuestDefinitionConfig>(quests.map((quest) => [quest.id, quest]));

    for (const quest of quests) {
      const schema: Record<string, { type: "number" | "boolean" }> = {
        active: { type: "boolean" },
        completed: { type: "boolean" },
      };
      for (let i = 0; i < MAX_OBJECTIVES_PER_QUEST; i++) schema[objectiveFieldName(i)] = { type: "boolean" };
      ctx.defineComponent<QuestStateShape>(questComponentName(quest.id), schema, QUEST_STATE_DEFAULTS);
    }

    function reject(entity: EntityId, questId: string, reason: QuestRejectedEvent["reason"]): void {
      ctx.events.emit("quest:rejected", { entity, questId, reason } satisfies QuestRejectedEvent);
    }

    function stateOf(entity: EntityId, questId: string): QuestStateShape | undefined {
      const componentName = questComponentName(questId);
      if (!ctx.world.has(entity, componentName)) return undefined;
      return ctx.world.get<QuestStateShape>(entity, componentName);
    }

    function objectivePatch(index: number, value: boolean): Partial<QuestStateShape> {
      const patch: Partial<QuestStateShape> = {};
      patch[objectiveFieldName(index)] = value;
      return patch;
    }

    ctx.events.on("quest:start", (payload) => {
      const { entity, questId } = payload as StartQuestEvent;
      const quest = questsById.get(questId);
      if (!quest) return reject(entity, questId, "unknownQuest");

      const componentName = questComponentName(questId);
      const current = stateOf(entity, questId);
      if (current?.active) return reject(entity, questId, "alreadyActive");
      if (current?.completed) return reject(entity, questId, "alreadyCompleted");

      if (ctx.world.has(entity, componentName)) {
        ctx.world.set<QuestStateShape>(entity, componentName, { active: true });
      } else {
        ctx.world.add<QuestStateShape>(entity, componentName, { ...QUEST_STATE_DEFAULTS, active: true });
      }
      ctx.events.emit("quest:started", { entity, questId } satisfies QuestStartedEvent);
    });

    ctx.events.on("quest:completeObjective", (payload) => {
      const { entity, questId, objectiveId } = payload as CompleteObjectiveEvent;
      const quest = questsById.get(questId);
      if (!quest) return reject(entity, questId, "unknownQuest");

      const objectiveIndex = quest.objectives.findIndex((objective) => objective.id === objectiveId);
      if (objectiveIndex === -1) return reject(entity, questId, "unknownObjective");

      const componentName = questComponentName(questId);
      const current = stateOf(entity, questId);
      if (!current?.active) return reject(entity, questId, "notActive");

      const field = objectiveFieldName(objectiveIndex);
      if (current[field]) return; // idempotent: already completed, not an error

      ctx.world.set<QuestStateShape>(entity, componentName, objectivePatch(objectiveIndex, true));
      ctx.events.emit("quest:objectiveCompleted", { entity, questId, objectiveId } satisfies ObjectiveCompletedEvent);

      const updated = stateOf(entity, questId)!;
      const allComplete = quest.objectives.every((_objective, index) => updated[objectiveFieldName(index)]);
      if (allComplete) {
        ctx.world.set<QuestStateShape>(entity, componentName, { active: false, completed: true });
        ctx.events.emit("quest:completed", { entity, questId } satisfies QuestCompletedEvent);
      }
    });

    ctx.events.on("quest:query", (payload) => {
      const { entity, questId } = payload as QueryQuestEvent;
      const quest = questsById.get(questId);
      const state = quest ? stateOf(entity, questId) : undefined;
      const completedObjectiveIds = quest && state
        ? quest.objectives.filter((_objective, index) => state[objectiveFieldName(index)]).map((objective) => objective.id)
        : [];
      ctx.events.emit("quest:queried", {
        entity,
        questId,
        active: state?.active ?? false,
        completed: state?.completed ?? false,
        completedObjectiveIds,
      } satisfies QuestQueriedEvent);
    });
  },
};

export default questsModule;
