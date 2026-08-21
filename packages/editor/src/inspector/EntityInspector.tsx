import { Button } from "@forge/ds";
import { JsonSchemaForm } from "./JsonSchemaForm";
import type { ObjectSchema } from "./jsonSchema";
import type { EntityDialogue, EntityPlacement } from "../store/projectStore";
import "./EntityInspector.css";

/**
 * A quick edit for a dialogue tree's first line only — speaker/text of
 * `dialogue.nodes[0]`. docs/adr/0018 Decision 2 widened `EntityDialogue`
 * to a real branching tree; the full authoring surface for choices/
 * multi-node trees is `DialogueTreeEditorDialog` (M10, opened via the
 * "Edit branching dialogue…" button below). This form is deliberately
 * narrower than that, not a replacement for it: editing here only ever
 * touches node 0's `speaker`/`text`, leaving any existing `choices`/
 * `locale`/`autoAdvanceSec` on that node and any further nodes
 * completely untouched — someone who already authored a branching tree
 * through the full editor doesn't lose that structure just because this
 * quick form was used afterward.
 */
export const NPC_DIALOGUE_SCHEMA: ObjectSchema = {
  type: "object",
  properties: {
    speaker: { type: "string", title: "Speaker", minLength: 1, maxLength: 40 },
    text: { type: "string", title: "Line", minLength: 1, maxLength: 200 },
  },
  required: ["speaker", "text"],
};

export interface EntityInspectorProps {
  entity: EntityPlacement;
  onConfigureDialogue: (entityId: string, dialogue: EntityDialogue) => void;
  onOpenDialogueEditor?: (entityId: string) => void;
  onRemove: (entityId: string) => void;
}

export function EntityInspector({ entity, onConfigureDialogue, onOpenDialogueEditor, onRemove }: EntityInspectorProps) {
  const nodes = entity.dialogue?.nodes ?? [];
  const firstNode = nodes[0];

  return (
    <div className="fg-entity-inspector">
      {entity.prefabId === "npc" && (
        <>
          <JsonSchemaForm
            schema={NPC_DIALOGUE_SCHEMA}
            values={{ speaker: firstNode?.speaker ?? "", text: firstNode?.text ?? "" }}
            onSubmit={(values) => {
              const updatedFirst = { ...firstNode, speaker: values.speaker as string, text: values.text as string };
              onConfigureDialogue(entity.id, { nodes: [updatedFirst, ...nodes.slice(1)] });
            }}
          />
          <Button variant="secondary" onClick={() => onOpenDialogueEditor?.(entity.id)}>
            Edit branching dialogue…
          </Button>
        </>
      )}
      {entity.prefabId === "player-start" && (
        <p className="fg-entity-inspector__hint">The player spawns here when you open the preview.</p>
      )}
      <Button variant="destructive" onClick={() => onRemove(entity.id)}>
        Remove
      </Button>
    </div>
  );
}
