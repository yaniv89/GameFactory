import { JsonSchemaForm } from "./JsonSchemaForm";
import type { ObjectSchema } from "./jsonSchema";
import type { SceneSummary } from "../store/projectStore";

/**
 * A scene's own inspectable shape, expressed the same way a module's
 * configSchema will be in Phase 5 — proving the JSON-Schema-driven
 * pipeline end to end on a real, first-party case before any module
 * config reaches it.
 */
export const SCENE_SCHEMA: ObjectSchema = {
  type: "object",
  properties: {
    name: { type: "string", title: "Name", minLength: 1, maxLength: 60 },
  },
  required: ["name"],
};

export interface SceneInspectorProps {
  scene: SceneSummary;
  onRename: (sceneId: string, name: string) => void;
}

export function SceneInspector({ scene, onRename }: SceneInspectorProps) {
  return (
    <JsonSchemaForm
      schema={SCENE_SCHEMA}
      values={{ name: scene.name }}
      onSubmit={(values) => onRename(scene.id, values.name as string)}
    />
  );
}
