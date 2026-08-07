import { JsonSchemaForm } from "./JsonSchemaForm";
import type { FormValues } from "./jsonSchema";
import type { ModuleManifest } from "../modules/moduleManifests";

export interface ModuleInspectorProps {
  manifest: ModuleManifest;
  config: FormValues;
  onConfigure: (moduleName: string, config: FormValues) => void;
}

/**
 * The JSON-Schema-driven pipeline's second real consumer, after
 * SceneInspector — a module's own `configSchema`, not a fictional example
 * (see moduleManifests.ts). Renders nothing when the module has no
 * configSchema (e.g. dialogue): the caller is expected to check
 * `manifest.configSchema` before selecting a module into the Inspector at
 * all, same as InspectorPanelContainer does for scenes.
 */
export function ModuleInspector({ manifest, config, onConfigure }: ModuleInspectorProps) {
  if (!manifest.configSchema) return null;
  return (
    <JsonSchemaForm
      schema={manifest.configSchema}
      values={config}
      onSubmit={(values) => onConfigure(manifest.name, values)}
    />
  );
}
