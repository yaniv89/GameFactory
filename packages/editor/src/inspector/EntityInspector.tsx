import { Button } from "@forge/ds";
import { JsonSchemaForm } from "./JsonSchemaForm";
import type { ObjectSchema } from "./jsonSchema";
import type { EntityDialogue, EntityPlacement } from "../store/projectStore";
import "./EntityInspector.css";

/** An NPC's one-line dialogue (Phase 7) — the simplest real shape @forge/dialogue's DialogueNodeConfig supports: a single speaker/text node, no choices, no branching. */
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
  onRemove: (entityId: string) => void;
}

export function EntityInspector({ entity, onConfigureDialogue, onRemove }: EntityInspectorProps) {
  return (
    <div className="fg-entity-inspector">
      {entity.kind === "npc" && (
        <JsonSchemaForm
          schema={NPC_DIALOGUE_SCHEMA}
          values={{ speaker: entity.dialogue?.speaker ?? "", text: entity.dialogue?.text ?? "" }}
          onSubmit={(values) =>
            onConfigureDialogue(entity.id, { speaker: values.speaker as string, text: values.text as string })
          }
        />
      )}
      {entity.kind === "player-start" && (
        <p className="fg-entity-inspector__hint">The player spawns here when you open the preview.</p>
      )}
      <Button variant="destructive" onClick={() => onRemove(entity.id)}>
        Remove
      </Button>
    </div>
  );
}
