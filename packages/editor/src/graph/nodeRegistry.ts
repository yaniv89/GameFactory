import { ABSOLUTE_REPEAT_CEILING, DEFAULT_REPEAT_CEILING, coreGraphNodes } from "@forge/graph-nodes-core";
import type { GraphNodeDefinition } from "@forge/module-api";
import { defaultsFromSchema, type FormValues, type ObjectSchema } from "../inspector/jsonSchema";

const EMPTY_SCHEMA: ObjectSchema = { type: "object", properties: {} };

/**
 * The "editor half" docs/adr/0017 Decision 4 describes — label/category/a
 * config form — kept in the editor package, not `@forge/graph-nodes-core`,
 * which stays runtime-only (M2's own scope boundary). Reuses the existing
 * `JsonSchemaForm`/`ObjectSchema` machinery (CLAUDE.md M4 Phase 4) rather
 * than inventing a second form renderer: a graph node's per-instance
 * config is the same kind of problem a module's install-time `configSchema`
 * already solves.
 */
export interface GraphNodeEditorMetadata {
  readonly label: string;
  readonly category: string;
  readonly configSchema: ObjectSchema;
  /**
   * `GraphNodeInstance.config` can hold shapes `FormValues` doesn't cover
   * (e.g. `core:forEachEntity`'s `components: string[]`) — `JsonSchemaForm`
   * itself only ever produces `FormValues` (CLAUDE.md's own narrow JSON
   * Schema subset). These two are the boundary: identity when omitted.
   */
  toFormValues?(config: Readonly<Record<string, unknown>>): FormValues;
  fromFormValues?(values: FormValues): Record<string, unknown>;
}

export interface GraphNodeRegistryEntry {
  readonly definition: GraphNodeDefinition;
  readonly editor: GraphNodeEditorMetadata;
}

const STRING_FIELD = (title: string): ObjectSchema => ({
  type: "object",
  properties: { component: { type: "string", title, minLength: 1 } },
});

const COMPONENT_SCHEMA = STRING_FIELD("Component");
const EVENT_SCHEMA: ObjectSchema = { type: "object", properties: { event: { type: "string", title: "Event name", minLength: 1 } } };

/** Splits/joins a comma-separated component list — the small, honest boundary `types.ts`'s own doc comment on `core:forEachEntity` already calls out (no array field type in the shared `FieldSchema` set). */
function splitComponents(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

const CORE_NODE_EDITOR_METADATA: Record<string, GraphNodeEditorMetadata> = {
  "core:createEntity": { label: "Create Entity", category: "Entity", configSchema: EMPTY_SCHEMA },
  "core:destroyEntity": { label: "Destroy Entity", category: "Entity", configSchema: EMPTY_SCHEMA },
  "core:getComponent": { label: "Get Component", category: "Component", configSchema: COMPONENT_SCHEMA },
  "core:hasComponent": { label: "Has Component", category: "Component", configSchema: COMPONENT_SCHEMA },
  "core:setComponent": { label: "Set Component", category: "Component", configSchema: COMPONENT_SCHEMA },
  "core:onEvent": { label: "On Event", category: "Events", configSchema: EVENT_SCHEMA },
  "core:emitEvent": { label: "Emit Event", category: "Events", configSchema: EVENT_SCHEMA },
  "core:equals": { label: "Equals", category: "Comparisons", configSchema: EMPTY_SCHEMA },
  "core:greaterThan": { label: "Greater Than", category: "Comparisons", configSchema: EMPTY_SCHEMA },
  "core:lessThan": { label: "Less Than", category: "Comparisons", configSchema: EMPTY_SCHEMA },
  "core:and": { label: "And", category: "Comparisons", configSchema: EMPTY_SCHEMA },
  "core:or": { label: "Or", category: "Comparisons", configSchema: EMPTY_SCHEMA },
  "core:not": { label: "Not", category: "Comparisons", configSchema: EMPTY_SCHEMA },
  "core:add": { label: "Add", category: "Math", configSchema: EMPTY_SCHEMA },
  "core:subtract": { label: "Subtract", category: "Math", configSchema: EMPTY_SCHEMA },
  "core:multiply": { label: "Multiply", category: "Math", configSchema: EMPTY_SCHEMA },
  "core:divide": { label: "Divide", category: "Math", configSchema: EMPTY_SCHEMA },
  "core:branch": { label: "Branch", category: "Flow", configSchema: EMPTY_SCHEMA },
  "core:repeat": {
    label: "Repeat",
    category: "Flow",
    configSchema: {
      type: "object",
      properties: {
        ceiling: { type: "integer", title: "Max iterations", minimum: 1, maximum: ABSOLUTE_REPEAT_CEILING, default: DEFAULT_REPEAT_CEILING },
      },
    },
  },
  "core:forEachEntity": {
    label: "For Each Entity",
    category: "Flow",
    configSchema: { type: "object", properties: { components: { type: "string", title: "Components (comma-separated)", default: "" } } },
    toFormValues: (config) => ({ components: Array.isArray(config.components) ? (config.components as string[]).join(", ") : "" }),
    fromFormValues: (values) => ({ components: splitComponents(String(values.components ?? "")) }),
  },
};

/** One entry per `@forge/graph-nodes-core` definition — the M2 library plus this file's own editor metadata, matching each other 1:1 by construction (both keyed by the same `core:*` type). */
export const NODE_REGISTRY: Readonly<Record<string, GraphNodeRegistryEntry>> = Object.fromEntries(
  coreGraphNodes.map((definition) => {
    const editor = CORE_NODE_EDITOR_METADATA[definition.type];
    if (!editor) throw new Error(`nodeRegistry: no editor metadata registered for node type "${definition.type}"`);
    return [definition.type, { definition, editor }];
  }),
);

export function defaultConfigFor(nodeType: string): Record<string, unknown> {
  const entry = NODE_REGISTRY[nodeType];
  if (!entry) return {};
  const formDefaults = defaultsFromSchema(entry.editor.configSchema);
  return entry.editor.fromFormValues ? entry.editor.fromFormValues(formDefaults) : formDefaults;
}

/** Grouped for the palette — one section per `category`, nodes in registry order within each. */
export function groupNodesByCategory(): ReadonlyArray<{ category: string; entries: readonly GraphNodeRegistryEntry[] }> {
  const groups = new Map<string, GraphNodeRegistryEntry[]>();
  for (const entry of Object.values(NODE_REGISTRY)) {
    const list = groups.get(entry.editor.category) ?? [];
    list.push(entry);
    groups.set(entry.editor.category, list);
  }
  return [...groups.entries()].map(([category, entries]) => ({ category, entries }));
}
