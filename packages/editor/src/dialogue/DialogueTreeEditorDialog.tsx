import { Button, Dialog, Select, Tree } from "@forge/ds";
import { useState } from "react";
import { JsonSchemaForm } from "../inspector/JsonSchemaForm";
import type { ObjectSchema } from "../inspector/jsonSchema";
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
import "./DialogueTreeEditorDialog.css";

const NODE_SCHEMA: ObjectSchema = {
  type: "object",
  properties: {
    speaker: { type: "string", title: "Speaker", minLength: 1, maxLength: 40 },
    text: { type: "string", title: "Line", minLength: 1, maxLength: 400 },
    locale: { type: "string", title: "Locale", maxLength: 10 },
    autoAdvanceSec: { type: "number", title: "Auto-advance after (seconds)" },
  },
  required: ["speaker", "text"],
};

const CHOICE_SCHEMA: ObjectSchema = {
  type: "object",
  properties: {
    id: { type: "string", title: "Choice ID", minLength: 1, maxLength: 40 },
    text: { type: "string", title: "Choice text", minLength: 1, maxLength: 120 },
  },
  required: ["id", "text"],
};

const END_DIALOGUE = -1;

function nodeLabel(node: DialogueTreeNode, index: number): string {
  const preview = node.text.length > 30 ? `${node.text.slice(0, 30)}…` : node.text;
  return `${index + 1}. ${node.speaker || "(no speaker)"}: ${preview || "(empty line)"}`;
}

export interface DialogueTreeEditorDialogProps {
  open: boolean;
  onClose: () => void;
  entityLabel: string;
  nodes: readonly DialogueTreeNode[];
  onChange: (nodes: readonly DialogueTreeNode[]) => void;
}

/**
 * docs/adr/0018 Decision 2 (M10) — a dedicated, list-and-form editor for a
 * branching dialogue tree, deliberately NOT graph-authored (the ADR's own
 * "match the tool to the content" reasoning: a conversation is a list
 * with jump points, not a typed-socket wiring problem). Matches
 * `GraphEditorDialog`'s own full-screen `Dialog` shape and its "Outline
 * tree + per-selection form" split, but with a plain `<select>` for "which
 * line does this choice jump to" — a dialogue choice has exactly one
 * destination, never `GraphEditorDialog`'s arbitrary typed-socket wiring,
 * so the keyboard connect-picker that needs would be over-built here.
 *
 * No per-node/per-choice commands exist in `projectStore.ts` for this
 * (unlike `GraphEditorDialog`'s `addGraphNode`/`moveGraphNode`/etc.) —
 * every edit here computes a whole new `nodes` array
 * (`dialogueTreeEditing.ts`'s pure helpers) and hands it to `onChange`,
 * which the container wires straight to the existing
 * `configureEntityDialogue` action. That action already does its own
 * JSON-diff no-op suppression, so this needs no debouncing of its own.
 */
export function DialogueTreeEditorDialog({ open, onClose, entityLabel, nodes, onChange }: DialogueTreeEditorDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | undefined>(nodes.length > 0 ? 0 : undefined);

  const selectedNode = selectedIndex !== undefined ? nodes[selectedIndex] : undefined;

  const destinationOptions = [
    { value: String(END_DIALOGUE), label: "(end dialogue)" },
    ...nodes.map((node, index) => ({ value: String(index), label: nodeLabel(node, index) })),
  ];

  const addNode = () => {
    const next = addDialogueNode(nodes);
    onChange(next);
    setSelectedIndex(next.length - 1);
  };

  const removeNode = (index: number) => {
    onChange(removeDialogueNode(nodes, index));
    setSelectedIndex(undefined);
  };

  const moveNode = (index: number, direction: "up" | "down") => {
    onChange(moveDialogueNode(nodes, index, direction));
    setSelectedIndex(direction === "up" ? index - 1 : index + 1);
  };

  return (
    <Dialog open={open} title={`Dialogue — ${entityLabel}`} onClose={onClose}>
      <div className="fg-dialogue-editor">
        <aside className="fg-dialogue-editor__outline">
          <Tree
            label="Dialogue Outline"
            state={nodes.length > 0 ? "populated" : "empty"}
            nodes={nodes.map((node, index) => ({ id: String(index), label: nodeLabel(node, index) }))}
            onSelect={(id) => setSelectedIndex(Number(id))}
            empty={{ title: "No lines yet", description: "Add the first line of this conversation.", actionLabel: "Add line", onAction: addNode }}
          />
          {nodes.length > 0 && (
            <Button variant="secondary" onClick={addNode}>
              Add line
            </Button>
          )}
        </aside>

        <div className="fg-dialogue-editor__body">
          {selectedNode && selectedIndex !== undefined ? (
            <>
              <div className="fg-dialogue-editor__node-header">
                <h3>Line {selectedIndex + 1}</h3>
                <div className="fg-dialogue-editor__node-actions">
                  <Button variant="secondary" disabled={selectedIndex === 0} onClick={() => moveNode(selectedIndex, "up")}>
                    Move up
                  </Button>
                  <Button variant="secondary" disabled={selectedIndex === nodes.length - 1} onClick={() => moveNode(selectedIndex, "down")}>
                    Move down
                  </Button>
                  <Button variant="destructive" onClick={() => removeNode(selectedIndex)}>
                    Delete line
                  </Button>
                </div>
              </div>

              <JsonSchemaForm
                schema={NODE_SCHEMA}
                values={{
                  speaker: selectedNode.speaker,
                  text: selectedNode.text,
                  locale: selectedNode.locale ?? "",
                  autoAdvanceSec: selectedNode.autoAdvanceSec ?? "",
                }}
                onSubmit={(values) =>
                  onChange(
                    configureDialogueNode(nodes, selectedIndex, {
                      speaker: values.speaker as string,
                      text: values.text as string,
                      locale: values.locale as string,
                      autoAdvanceSec: Number.isFinite(values.autoAdvanceSec) ? (values.autoAdvanceSec as number) : undefined,
                    }),
                  )
                }
              />

              <div className="fg-dialogue-editor__choices">
                <h4>Choices</h4>
                <p className="fg-list__secondary">
                  {selectedNode.choices && selectedNode.choices.length > 0
                    ? "Leave no choices to end the dialogue automatically after this line."
                    : "No choices — this line ends the dialogue. Add one to branch."}
                </p>
                <ul className="fg-list">
                  {(selectedNode.choices ?? []).map((choice, choiceIndex) => (
                    <li key={choiceIndex} className="fg-dialogue-editor__choice-row">
                      <JsonSchemaForm
                        schema={CHOICE_SCHEMA}
                        values={{ id: choice.id, text: choice.text }}
                        onSubmit={(values) =>
                          onChange(
                            configureDialogueChoice(nodes, selectedIndex, choiceIndex, {
                              id: values.id as string,
                              text: values.text as string,
                              next: choice.next,
                            }),
                          )
                        }
                      />
                      <Select
                        label="Leads to"
                        options={destinationOptions}
                        value={String(choice.next)}
                        onChange={(event) =>
                          onChange(
                            configureDialogueChoice(nodes, selectedIndex, choiceIndex, {
                              id: choice.id,
                              text: choice.text,
                              next: Number(event.target.value),
                            }),
                          )
                        }
                      />
                      <Button variant="destructive" onClick={() => onChange(removeDialogueChoice(nodes, selectedIndex, choiceIndex))}>
                        Remove choice
                      </Button>
                    </li>
                  ))}
                </ul>
                <Button variant="secondary" onClick={() => onChange(addDialogueChoice(nodes, selectedIndex, crypto.randomUUID()))}>
                  Add choice
                </Button>
              </div>
            </>
          ) : (
            <p className="fg-list__secondary">Select a line to edit it, or add the first one.</p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
