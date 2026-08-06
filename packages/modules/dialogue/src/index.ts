import type { EntityId, ForgeModule, SetupContext } from "@forge/module-api";
import {
  DIALOGUE_STATE_COMPONENT,
  NO_AUTO_ADVANCE,
  type ChooseDialogueEvent,
  type DialogueAutoAdvanceElapsedEvent,
  type DialogueChoicesShownEvent,
  type DialogueEndedEvent,
  type DialogueModuleConfig,
  type DialogueShownEvent,
  type DialogueStateShape,
  type DialogueTreeConfig,
  type StartDialogueEvent,
} from "./types";

export * from "./types";

function validateTrees(ctx: SetupContext): readonly DialogueTreeConfig[] {
  const raw = (ctx.config as DialogueModuleConfig).trees;
  if (!Array.isArray(raw)) return [];
  const valid: DialogueTreeConfig[] = [];
  for (const tree of raw) {
    if (typeof tree?.id !== "string" || !Array.isArray(tree.nodes) || tree.nodes.length === 0) {
      ctx.log.warn("dialogue: skipping a malformed tree in config.trees (needs a string id and a non-empty nodes array)", { tree });
      continue;
    }
    valid.push(tree as DialogueTreeConfig);
  }
  return valid;
}

/**
 * @forge/dialogue — a dialogue-tree runner. Built entirely against
 * @forge/module-api, per CLAUDE.md Section 3.2: this is the exercise that
 * proved the v1 surface needed `SetupContext.runInterceptor` and
 * `SetupContext.world` (docs/adr/0006) before it could be written at all.
 *
 * Dialogue trees come from `config.trees` (docs/SPEC.md Section 9.2's
 * `configSchema`, validated by the registry at install time — this module
 * just defends against a malformed shape reaching it anyway). Starting,
 * advancing, and ending a dialogue all happen over `events` — the only
 * inter-module channel per SPEC 9.3 — so any other module (a quest system,
 * an NPC AI) can drive a conversation without a direct dependency on this
 * one. `dialogue:line`/`dialogue:choices` (from `@forge/module-api`'s
 * `InterceptorMap`) are triggered via `ctx.runInterceptor` for every line
 * shown, so a translation or text-effects module can transform the output
 * without patching this module — the WordPress-filter pattern docs/SPEC.md
 * Section 9.4 describes.
 */
export const dialogueModule: ForgeModule = {
  setup(ctx: SetupContext): void {
    const trees = validateTrees(ctx);
    ctx.defineComponent<DialogueStateShape>(
      DIALOGUE_STATE_COMPONENT,
      {
        active: { type: "boolean" },
        tree: { type: "number" },
        node: { type: "number" },
        autoAdvanceSec: { type: "number" },
      },
      { active: false, tree: 0, node: 0, autoAdvanceSec: NO_AUTO_ADVANCE },
    );

    function endDialogue(entity: EntityId, treeId: string): void {
      if (ctx.world.has(entity, DIALOGUE_STATE_COMPONENT)) {
        ctx.world.set<DialogueStateShape>(entity, DIALOGUE_STATE_COMPONENT, { active: false, autoAdvanceSec: NO_AUTO_ADVANCE });
      }
      ctx.storage.set(`completed:${treeId}`, true);
      ctx.events.emit("dialogue:ended", { entity, treeId } satisfies DialogueEndedEvent);
    }

    function showNode(entity: EntityId, treeIndex: number, nodeIndex: number): void {
      const tree = trees[treeIndex];
      const node = tree?.nodes[nodeIndex];
      if (!tree || !node) {
        ctx.log.error("dialogue: node index out of range, ending dialogue", { entity, treeIndex, nodeIndex });
        if (tree) endDialogue(entity, tree.id);
        return;
      }

      if (ctx.world.has(entity, DIALOGUE_STATE_COMPONENT)) {
        ctx.world.set<DialogueStateShape>(entity, DIALOGUE_STATE_COMPONENT, {
          active: true,
          tree: treeIndex,
          node: nodeIndex,
          autoAdvanceSec: node.autoAdvanceSec ?? NO_AUTO_ADVANCE,
        });
      } else {
        ctx.world.add<DialogueStateShape>(entity, DIALOGUE_STATE_COMPONENT, {
          active: true,
          tree: treeIndex,
          node: nodeIndex,
          autoAdvanceSec: node.autoAdvanceSec ?? NO_AUTO_ADVANCE,
        });
      }

      const line = ctx.runInterceptor("dialogue:line", {
        speaker: node.speaker,
        text: node.text,
        locale: node.locale ?? "en",
      });
      ctx.events.emit("dialogue:shown", { entity, ...line } satisfies DialogueShownEvent);

      if (node.choices && node.choices.length > 0) {
        const filtered = ctx.runInterceptor("dialogue:choices", {
          choices: node.choices.map((choice) => ({ id: choice.id, text: choice.text })),
        });
        ctx.events.emit("dialogue:choicesShown", { entity, choices: filtered.choices } satisfies DialogueChoicesShownEvent);
      } else {
        endDialogue(entity, tree.id);
      }
    }

    ctx.events.on("dialogue:start", (payload) => {
      const { entity, treeId } = payload as StartDialogueEvent;
      const treeIndex = trees.findIndex((tree) => tree.id === treeId);
      if (treeIndex === -1) {
        ctx.log.error("dialogue:start referenced an unknown tree id", { treeId });
        return;
      }
      showNode(entity, treeIndex, 0);
    });

    ctx.events.on("dialogue:choose", (payload) => {
      const { entity, choiceId } = payload as ChooseDialogueEvent;
      const state = ctx.world.get<DialogueStateShape>(entity, DIALOGUE_STATE_COMPONENT);
      if (!state || !state.active) {
        ctx.log.warn("dialogue:choose received for an entity with no active dialogue", { entity });
        return;
      }
      const tree = trees[state.tree];
      const node = tree?.nodes[state.node];
      const choice = node?.choices?.find((c) => c.id === choiceId);
      if (!tree || !node || !choice) {
        ctx.log.error("dialogue:choose referenced an unknown choice id for the current node", { entity, choiceId });
        return;
      }
      if (choice.next === -1) {
        endDialogue(entity, tree.id);
      } else {
        showNode(entity, state.tree, choice.next);
      }
    });

    ctx.addSystem({
      id: "autoAdvance",
      phase: "Update",
      query: [DIALOGUE_STATE_COMPONENT],
      run(tick, entities) {
        entities.forEach((entity) => {
          const state = tick.world.get<DialogueStateShape>(entity, DIALOGUE_STATE_COMPONENT);
          if (!state || !state.active || state.autoAdvanceSec < 0) return;

          const remaining = state.autoAdvanceSec - tick.dt;
          if (remaining > 0) {
            tick.world.set<DialogueStateShape>(entity, DIALOGUE_STATE_COMPONENT, { autoAdvanceSec: remaining });
            return;
          }

          tick.world.set<DialogueStateShape>(entity, DIALOGUE_STATE_COMPONENT, { autoAdvanceSec: NO_AUTO_ADVANCE });
          const tree = trees[state.tree];
          const node = tree?.nodes[state.node];
          const firstChoice = node?.choices?.[0];
          if (!tree) return;
          if (firstChoice) {
            ctx.events.emit("dialogue:choose", { entity, choiceId: firstChoice.id } satisfies ChooseDialogueEvent);
          } else {
            ctx.events.emit("dialogue:autoAdvanceElapsed", { entity, treeId: tree.id } satisfies DialogueAutoAdvanceElapsedEvent);
          }
        });
      },
    });
  },
};

export default dialogueModule;
