import type { GraphNodeDefinition } from "@forge/module-api";

/**
 * docs/adr/0018 Decision 1: quest *logic* is authored as an ordinary
 * graph, using these four additive node types to call into
 * `@forge/quests`' own event surface — no different in kind from
 * `core:emitEvent`, they just happen to know the fixed event names
 * `@forge/quests` (`packages/modules/quests/src/index.ts`) listens on,
 * the same way `core:onEvent` already knows nothing about any specific
 * event's payload shape beyond what the author configures.
 *
 * `core:questStart`/`core:questCompleteObjective` are impure (they cause
 * a real state change via `quest:start`/`quest:completeObjective`).
 * `core:questIsActive`/`core:questIsObjectiveComplete` are pure — a graph
 * node has no `storage` access (`GraphNodeExecutionContext`, `graph.ts`),
 * so reading quest state back out uses the same synchronous
 * request/response pattern `inventory:query`/`inventory:queried` already
 * establishes for a host-side reader: `EventBus.emit` calls every
 * registered handler synchronously and in order
 * (`packages/core/src/events/eventBus.ts`), so subscribing to
 * `quest:queried`, emitting `quest:query`, and reading the captured
 * response back out all happen within one `execute()` call — no change to
 * `@forge/graph-runtime`'s interpreter needed. If no `@forge/quests`
 * instance is listening (the module isn't installed), the response never
 * arrives; both pure nodes below fall back to "not active"/"not complete"
 * and `ctx.warn` rather than throwing, the same graceful-degradation
 * treatment `core:getComponent` gives a nonexistent component.
 */
interface QuestQueriedPayload {
  readonly entity: unknown;
  readonly questId: string;
  readonly active: boolean;
  readonly completed: boolean;
  readonly completedObjectiveIds: readonly string[];
}

function queryQuest(
  ctx: Parameters<GraphNodeDefinition["execute"]>[0],
  entity: unknown,
  questId: string,
): QuestQueriedPayload | undefined {
  let response: QuestQueriedPayload | undefined;
  const unsubscribe = ctx.events.on("quest:queried", (payload) => {
    const p = payload as QuestQueriedPayload;
    if (p.entity === entity && p.questId === questId) response = p;
  });
  ctx.events.emit("quest:query", { entity, questId });
  unsubscribe();
  return response;
}

export const questStartNode: GraphNodeDefinition = {
  type: "core:questStart",
  inputs: [
    { name: "flow", type: "flow" },
    { name: "entity", type: "entity" },
  ],
  outputs: [{ name: "flow", type: "flow" }],
  execute(ctx, inputs, config) {
    ctx.events.emit("quest:start", { entity: inputs.entity, questId: config.questId as string });
    ctx.next("flow");
  },
};

export const questCompleteObjectiveNode: GraphNodeDefinition = {
  type: "core:questCompleteObjective",
  inputs: [
    { name: "flow", type: "flow" },
    { name: "entity", type: "entity" },
  ],
  outputs: [{ name: "flow", type: "flow" }],
  execute(ctx, inputs, config) {
    ctx.events.emit("quest:completeObjective", {
      entity: inputs.entity,
      questId: config.questId as string,
      objectiveId: config.objectiveId as string,
    });
    ctx.next("flow");
  },
};

export const questIsActiveNode: GraphNodeDefinition = {
  type: "core:questIsActive",
  inputs: [{ name: "entity", type: "entity" }],
  outputs: [{ name: "active", type: "boolean" }],
  execute(ctx, inputs, config) {
    const questId = config.questId as string;
    const result = queryQuest(ctx, inputs.entity, questId);
    if (!result) {
      ctx.warn(`core:questIsActive got no response for quest "${questId}" — is @forge/quests installed?`, { questId });
      return { active: false };
    }
    return { active: result.active };
  },
};

export const questIsObjectiveCompleteNode: GraphNodeDefinition = {
  type: "core:questIsObjectiveComplete",
  inputs: [{ name: "entity", type: "entity" }],
  outputs: [{ name: "complete", type: "boolean" }],
  execute(ctx, inputs, config) {
    const questId = config.questId as string;
    const objectiveId = config.objectiveId as string;
    const result = queryQuest(ctx, inputs.entity, questId);
    if (!result) {
      ctx.warn(`core:questIsObjectiveComplete got no response for quest "${questId}" — is @forge/quests installed?`, { questId, objectiveId });
      return { complete: false };
    }
    return { complete: result.completedObjectiveIds.includes(objectiveId) };
  },
};
