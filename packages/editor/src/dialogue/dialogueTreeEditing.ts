import type { DialogueTreeNode } from "../store/projectStore";

/**
 * Pure edit operations over a `DialogueTreeNode[]` (docs/adr/0018
 * Decision 2, M10), separated from `DialogueTreeEditorDialog.tsx` the
 * same way `graphValidation.ts` is separated from `GraphEditorDialog.tsx`
 * — independently unit-testable, no React involved.
 *
 * `DialogueTreeEditorDialog` has no per-node CRUD commands of its own in
 * `projectStore.ts` (unlike `GraphEditorDialog`'s `addGraphNode`/
 * `moveGraphNode`/etc.) — every edit here computes a brand-new whole
 * `nodes` array and hands it to the existing `configureEntityDialogue`
 * action, which already does its own JSON-diff no-op suppression. The
 * one thing that action can't do for us is keep `DialogueTreeChoice.next`
 * (a plain index into this same array) pointing at the right node after
 * a reorder or removal — that remapping is this module's actual job.
 */

const NO_DESTINATION = -1;

function remapChoiceNext(node: DialogueTreeNode, mapIndex: (index: number) => number): DialogueTreeNode {
  if (!node.choices || node.choices.length === 0) return node;
  return {
    ...node,
    choices: node.choices.map((choice) => (choice.next === NO_DESTINATION ? choice : { ...choice, next: mapIndex(choice.next) })),
  };
}

export function addDialogueNode(nodes: readonly DialogueTreeNode[]): DialogueTreeNode[] {
  return [...nodes, { speaker: "", text: "" }];
}

/** Any choice (on any node) that pointed at the removed node now ends the dialogue (`-1`), the same "target no longer exists" fallback `graph/remove-node`'s cascade uses for edges touching a removed graph node. */
export function removeDialogueNode(nodes: readonly DialogueTreeNode[], index: number): DialogueTreeNode[] {
  const mapIndex = (candidate: number): number => {
    if (candidate === index) return NO_DESTINATION;
    return candidate < index ? candidate : candidate - 1;
  };
  return nodes.filter((_, i) => i !== index).map((node) => remapChoiceNext(node, mapIndex));
}

/** Swaps `index` with its neighbor in `direction`, remapping every choice's `next` so it keeps pointing at the same *node*, not the same *position*. A no-op (returns the input array unchanged) at either end of the list. */
export function moveDialogueNode(nodes: readonly DialogueTreeNode[], index: number, direction: "up" | "down"): DialogueTreeNode[] {
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= nodes.length) return nodes as DialogueTreeNode[];
  const mapIndex = (candidate: number): number => {
    if (candidate === index) return swapWith;
    if (candidate === swapWith) return index;
    return candidate;
  };
  const next = [...nodes];
  const a = next[index]!;
  const b = next[swapWith]!;
  next[index] = b;
  next[swapWith] = a;
  return next.map((node) => remapChoiceNext(node, mapIndex));
}

export function configureDialogueNode(
  nodes: readonly DialogueTreeNode[],
  index: number,
  patch: { speaker: string; text: string; locale: string; autoAdvanceSec: number | undefined },
): DialogueTreeNode[] {
  return nodes.map((node, i) => {
    if (i !== index) return node;
    const { locale, autoAdvanceSec, ...rest } = patch;
    return {
      ...rest,
      // exactOptionalPropertyTypes: an empty locale means "unset", not "".
      ...(locale ? { locale } : {}),
      ...(autoAdvanceSec !== undefined ? { autoAdvanceSec } : {}),
      ...(node.choices ? { choices: node.choices } : {}),
    };
  });
}

export function addDialogueChoice(nodes: readonly DialogueTreeNode[], nodeIndex: number, choiceId: string): DialogueTreeNode[] {
  return nodes.map((node, i) => {
    if (i !== nodeIndex) return node;
    return { ...node, choices: [...(node.choices ?? []), { id: choiceId, text: "", next: NO_DESTINATION }] };
  });
}

export function removeDialogueChoice(nodes: readonly DialogueTreeNode[], nodeIndex: number, choiceIndex: number): DialogueTreeNode[] {
  return nodes.map((node, i) => {
    if (i !== nodeIndex || !node.choices) return node;
    const choices = node.choices.filter((_, ci) => ci !== choiceIndex);
    if (choices.length > 0) return { ...node, choices };
    const { choices: _drop, ...rest } = node;
    return rest;
  });
}

export function configureDialogueChoice(
  nodes: readonly DialogueTreeNode[],
  nodeIndex: number,
  choiceIndex: number,
  patch: { id: string; text: string; next: number },
): DialogueTreeNode[] {
  return nodes.map((node, i) => {
    if (i !== nodeIndex || !node.choices) return node;
    return { ...node, choices: node.choices.map((choice, ci) => (ci === choiceIndex ? { ...patch } : choice)) };
  });
}
