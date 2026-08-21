import { describe, expect, it } from "vitest";
import type { DialogueTreeNode } from "../store/projectStore";
import {
  addDialogueChoice,
  addDialogueNode,
  configureDialogueChoice,
  configureDialogueNode,
  moveDialogueNode,
  removeDialogueChoice,
  removeDialogueNode,
} from "./dialogueTreeEditing";

const TWO_NODE_TREE: DialogueTreeNode[] = [
  { speaker: "Elder", text: "Choose wisely.", choices: [{ id: "yes", text: "I will.", next: 1 }] },
  { speaker: "Elder", text: "Good choice." },
];

describe("addDialogueNode", () => {
  it("appends a blank node, leaving existing nodes and choices untouched", () => {
    const result = addDialogueNode(TWO_NODE_TREE);
    expect(result).toHaveLength(3);
    expect(result[2]).toEqual({ speaker: "", text: "" });
    expect(result[0]).toEqual(TWO_NODE_TREE[0]);
  });
});

describe("removeDialogueNode", () => {
  it("removes the node at the given index and shifts later indices down", () => {
    const three: DialogueTreeNode[] = [...TWO_NODE_TREE, { speaker: "Elder", text: "Farewell." }];
    const result = removeDialogueNode(three, 1);
    expect(result).toHaveLength(2);
    expect(result.map((n) => n.text)).toEqual(["Choose wisely.", "Farewell."]);
  });

  it("redirects a choice that pointed at the removed node to -1 (end dialogue)", () => {
    const result = removeDialogueNode(TWO_NODE_TREE, 1);
    expect(result).toHaveLength(1);
    expect(result[0]!.choices).toEqual([{ id: "yes", text: "I will.", next: -1 }]);
  });

  it("shifts a choice's next index down when a node before its target is removed", () => {
    const three: DialogueTreeNode[] = [
      { speaker: "A", text: "a" },
      { speaker: "B", text: "b", choices: [{ id: "c", text: "go", next: 2 }] },
      { speaker: "C", text: "c" },
    ];
    const result = removeDialogueNode(three, 0);
    expect(result).toHaveLength(2);
    expect(result[0]!.choices).toEqual([{ id: "c", text: "go", next: 1 }]);
  });

  it("never touches an already-terminal (-1) choice", () => {
    const withEnd: DialogueTreeNode[] = [{ speaker: "A", text: "a", choices: [{ id: "c", text: "bye", next: -1 }] }, { speaker: "B", text: "b" }];
    const result = removeDialogueNode(withEnd, 1);
    expect(result[0]!.choices).toEqual([{ id: "c", text: "bye", next: -1 }]);
  });
});

describe("moveDialogueNode", () => {
  it("swaps a node with its upward neighbor and keeps choices pointed at the same node", () => {
    const three: DialogueTreeNode[] = [
      { speaker: "A", text: "a" },
      { speaker: "B", text: "b", choices: [{ id: "c", text: "go", next: 2 }] },
      { speaker: "C", text: "c" },
    ];
    const result = moveDialogueNode(three, 2, "up");
    expect(result.map((n) => n.speaker)).toEqual(["A", "C", "B"]);
    // "B" (now at index 2) still points at "C" (now at index 1).
    expect(result[2]!.choices).toEqual([{ id: "c", text: "go", next: 1 }]);
  });

  it("swaps a node with its downward neighbor", () => {
    const result = moveDialogueNode(TWO_NODE_TREE, 0, "down");
    expect(result.map((n) => n.speaker)).toEqual(["Elder", "Elder"]);
    expect(result.map((n) => n.text)).toEqual(["Good choice.", "Choose wisely."]);
    // The choice moved along with its owning node and still points at index 0 ("Good choice.", the other node).
    expect(result[1]!.choices).toEqual([{ id: "yes", text: "I will.", next: 0 }]);
  });

  it("is a no-op at the top boundary", () => {
    const result = moveDialogueNode(TWO_NODE_TREE, 0, "up");
    expect(result).toBe(TWO_NODE_TREE);
  });

  it("is a no-op at the bottom boundary", () => {
    const result = moveDialogueNode(TWO_NODE_TREE, 1, "down");
    expect(result).toBe(TWO_NODE_TREE);
  });

  it("a self-referencing choice keeps pointing at its own (moved) node", () => {
    const withSelfLoop: DialogueTreeNode[] = [
      { speaker: "A", text: "a", choices: [{ id: "c", text: "again", next: 0 }] },
      { speaker: "B", text: "b" },
    ];
    const result = moveDialogueNode(withSelfLoop, 0, "down");
    expect(result[1]!.choices).toEqual([{ id: "c", text: "again", next: 1 }]);
  });
});

describe("configureDialogueNode", () => {
  it("updates speaker/text/locale/autoAdvanceSec, preserving existing choices", () => {
    const result = configureDialogueNode(TWO_NODE_TREE, 0, { speaker: "Guard", text: "Halt.", locale: "en", autoAdvanceSec: 3 });
    expect(result[0]).toEqual({ speaker: "Guard", text: "Halt.", locale: "en", autoAdvanceSec: 3, choices: TWO_NODE_TREE[0]!.choices });
  });

  it("omits locale/autoAdvanceSec when cleared rather than setting them to empty/undefined", () => {
    const result = configureDialogueNode(TWO_NODE_TREE, 0, { speaker: "Elder", text: "Choose wisely.", locale: "", autoAdvanceSec: undefined });
    expect("locale" in result[0]!).toBe(false);
    expect("autoAdvanceSec" in result[0]!).toBe(false);
  });

  it("leaves every other node untouched", () => {
    const result = configureDialogueNode(TWO_NODE_TREE, 0, { speaker: "Guard", text: "Halt.", locale: "", autoAdvanceSec: undefined });
    expect(result[1]).toBe(TWO_NODE_TREE[1]);
  });
});

describe("addDialogueChoice / removeDialogueChoice / configureDialogueChoice", () => {
  it("addDialogueChoice appends a blank, terminal (-1) choice to the given node only", () => {
    const result = addDialogueChoice(TWO_NODE_TREE, 1, "new-choice-id");
    expect(result[1]!.choices).toEqual([{ id: "new-choice-id", text: "", next: -1 }]);
    expect(result[0]).toBe(TWO_NODE_TREE[0]);
  });

  it("configureDialogueChoice replaces one choice by index", () => {
    const result = configureDialogueChoice(TWO_NODE_TREE, 0, 0, { id: "yes", text: "Absolutely.", next: 0 });
    expect(result[0]!.choices).toEqual([{ id: "yes", text: "Absolutely.", next: 0 }]);
  });

  it("removeDialogueChoice drops choices entirely (no empty array left behind) once the last one is removed", () => {
    const result = removeDialogueChoice(TWO_NODE_TREE, 0, 0);
    expect("choices" in result[0]!).toBe(false);
  });

  it("removeDialogueChoice keeps the remaining choices when more than one exists", () => {
    const twoChoices: DialogueTreeNode = {
      speaker: "Elder",
      text: "Choose.",
      choices: [{ id: "a", text: "A", next: -1 }, { id: "b", text: "B", next: -1 }],
    };
    const result = removeDialogueChoice([twoChoices], 0, 0);
    expect(result[0]!.choices).toEqual([{ id: "b", text: "B", next: -1 }]);
  });
});
