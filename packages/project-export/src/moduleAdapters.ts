import type { EntityPlacement, ProjectDocument } from "./documentTypes.js";

/**
 * Per-module export adapters (docs/adr/0009 decision 2), keyed by module
 * name. Default (no entry — see `resolveModuleConfig` below) is
 * passthrough: the installed `FormValues` used as-is, correct for any
 * module whose `configSchema` already mirrors `SetupContext.config`
 * (`@forge/inventory`, `@forge/turn-battle` today —
 * `packages/editor/src/modules/moduleManifests.ts`'s own comment: "mirrors
 * what each module's SetupContext.config actually reads ... not a
 * fictional example").
 */
type ModuleExportAdapter = (document: ProjectDocument, config: Record<string, unknown>) => Record<string, unknown>;

export interface DialogueTree {
  readonly id: string;
  readonly nodes: readonly { readonly speaker: string; readonly text: string }[];
}

/**
 * One `@forge/dialogue` tree per NPC with dialogue among `entities`, same
 * shape and the same `treeId == placementId` convention
 * `packages/editor/src/preview/PreviewApp.tsx`'s `rebuildDialogueRuntime`
 * uses for the unsandboxed preview and `packages/player/src/gameLogic.ts`
 * already emits (`dialogue:start` with `treeId: nearestId`), expecting
 * the real dialogue module's guest code to resolve it. Exported
 * separately from `buildDialogueConfig` below (which aggregates across
 * every scene, correct for an export/publish where the module installs
 * once for the whole project) so the preview — which only ever cares
 * about its own single active scene — can call this directly instead of
 * carrying its own independent copy of the same logic.
 */
export function buildDialogueTreesFromEntities(entities: readonly EntityPlacement[]): readonly DialogueTree[] {
  // Any prefab with dialogue set becomes a tree — not gated on a specific
  // prefabId. Dropping the old `kind === "npc"` check is strictly more
  // correct: it no longer arbitrarily excludes a future non-"npc" prefab
  // (docs/adr/0015-entity-prefab-component-model.md, the moduleAdapters.ts
  // row of its call-site table) that happens to carry dialogue too.
  return entities
    .filter((entity): entity is EntityPlacement & { dialogue: NonNullable<EntityPlacement["dialogue"]> } =>
      entity.dialogue !== undefined,
    )
    .map((entity) => ({ id: entity.id, nodes: [{ speaker: entity.dialogue.speaker, text: entity.dialogue.text }] }));
}

/**
 * `@forge/dialogue` has no `configSchema` (trees aren't flat-form-
 * editable) — its real config is synthesized from every scene's NPC
 * dialogue, aggregated across the whole project (a module is installed
 * once; its config is shared across every scene, matching multi-scene
 * support already shipped for `scene:changed`).
 */
function buildDialogueConfig(document: ProjectDocument): Record<string, unknown> {
  return {
    trees: document.scenes.flatMap((scene) => buildDialogueTreesFromEntities(scene.entities)),
  };
}

const MODULE_EXPORT_ADAPTERS: Readonly<Record<string, ModuleExportAdapter>> = {
  "@forge/dialogue": (document) => buildDialogueConfig(document),
};

/** Resolves what actually goes into `PlayerInstalledModule.config` for one installed module — the adapter above if one exists for `moduleName`, otherwise the installed `FormValues` unchanged. */
export function resolveModuleConfig(
  moduleName: string,
  document: ProjectDocument,
  installedConfig: Record<string, unknown>,
): Record<string, unknown> {
  const adapter = MODULE_EXPORT_ADAPTERS[moduleName];
  return adapter ? adapter(document, installedConfig) : installedConfig;
}
