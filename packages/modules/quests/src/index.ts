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

    /**
     * Found while building M13's own exit-criteria proof (docs/adr/0018):
     * a graph that starts a quest and completes its objective in the same
     * synchronous reaction (e.g. one `pickup:collected` handler) always
     * used to fail the objective-completion silently. `WorldApi.add`
     * (`@forge/module-api`'s own doc comment on `WorldApi`) is deferred to
     * the next flush — correct, deliberate ECS batching
     * (`packages/core/src/ecs/world.ts`'s own `CommandBuffer` doc comment)
     * — so `quest:start`'s first-ever `ctx.world.add` for an entity was
     * never actually visible to the very next `ctx.world.get` inside the
     * same synchronous call chain, and `quest:completeObjective` rejected
     * with `"notActive"` even though the quest had, from the author's
     * perspective, obviously just started.
     *
     * This cache is the fix: the *decision* source (`stateOf`, below) is
     * this always-synchronous in-memory map, never `ctx.world` directly.
     * `ctx.world.add`/`.set` still run on every change, same as before —
     * they remain the durable, inspectable, save/load-serializable mirror
     * (`docs/SPEC.md`'s own "ECS component snapshot" persistence model,
     * and what `__forgePreviewDebug`'s test hook reads) — just no longer
     * the thing this module's own logic waits on.
     */
    const stateCache = new Map<string, QuestStateShape>();
    function cacheKey(entity: EntityId, questId: string): string {
      return `${entity}:${questId}`;
    }

    // Seed the cache from whatever component state already exists (e.g. a
    // restored dev-preview save, `PreviewApp.tsx`'s own `devPreviewRestore`
    // — I1f, which serializes and restores a player entity's *entire*
    // component set, `Quest_<id>` included, with no awareness this module
    // even exists) — so a fresh `setup()` call (a rebuild, or the one-shot
    // preview attach) agrees with the world it's actually looking at,
    // rather than starting blank and re-rejecting an already-active quest
    // as "unknown" state.
    for (const quest of quests) {
      const componentName = questComponentName(quest.id);
      ctx.world.query([componentName]).forEach((entity) => {
        const state = ctx.world.get<QuestStateShape>(entity, componentName);
        if (state) stateCache.set(cacheKey(entity, quest.id), state);
      });
    }

    function reject(entity: EntityId, questId: string, reason: QuestRejectedEvent["reason"]): void {
      ctx.events.emit("quest:rejected", { entity, questId, reason } satisfies QuestRejectedEvent);
    }

    function stateOf(entity: EntityId, questId: string): QuestStateShape | undefined {
      return stateCache.get(cacheKey(entity, questId));
    }

    /** Mirrors `state` into the ECS component — `add` if this is the first write ever for `entity`/`questId` (the component doesn't exist in the world's own view yet, even though the cache may already know better), `set` otherwise. Never the decision source (see `stateCache`'s own doc comment above) — purely for persistence and external inspection. */
    function persist(entity: EntityId, questId: string, state: QuestStateShape): void {
      const componentName = questComponentName(questId);
      if (ctx.world.has(entity, componentName)) {
        ctx.world.set<QuestStateShape>(entity, componentName, state);
      } else {
        ctx.world.add<QuestStateShape>(entity, componentName, state);
      }
    }

    ctx.events.on("quest:start", (payload) => {
      const { entity, questId } = payload as StartQuestEvent;
      const quest = questsById.get(questId);
      if (!quest) return reject(entity, questId, "unknownQuest");

      const current = stateOf(entity, questId);
      if (current?.active) return reject(entity, questId, "alreadyActive");
      if (current?.completed) return reject(entity, questId, "alreadyCompleted");

      const next: QuestStateShape = { ...QUEST_STATE_DEFAULTS, active: true };
      stateCache.set(cacheKey(entity, questId), next);
      persist(entity, questId, next);
      ctx.events.emit("quest:started", { entity, questId } satisfies QuestStartedEvent);
    });

    ctx.events.on("quest:completeObjective", (payload) => {
      const { entity, questId, objectiveId } = payload as CompleteObjectiveEvent;
      const quest = questsById.get(questId);
      if (!quest) return reject(entity, questId, "unknownQuest");

      const objectiveIndex = quest.objectives.findIndex((objective) => objective.id === objectiveId);
      if (objectiveIndex === -1) return reject(entity, questId, "unknownObjective");

      const current = stateOf(entity, questId);
      if (!current?.active) return reject(entity, questId, "notActive");

      const field = objectiveFieldName(objectiveIndex);
      if (current[field]) return; // idempotent: already completed, not an error

      const updated: QuestStateShape = { ...current, [field]: true };
      const allComplete = quest.objectives.every((_objective, index) => updated[objectiveFieldName(index)]);
      if (allComplete) {
        updated.active = false;
        updated.completed = true;
      }
      stateCache.set(cacheKey(entity, questId), updated);
      persist(entity, questId, updated);

      ctx.events.emit("quest:objectiveCompleted", { entity, questId, objectiveId } satisfies ObjectiveCompletedEvent);
      if (allComplete) ctx.events.emit("quest:completed", { entity, questId } satisfies QuestCompletedEvent);
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
