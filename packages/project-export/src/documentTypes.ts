/**
 * The editor's ProjectDocument shape — moved here verbatim from
 * `packages/editor/src/store/projectStore.ts` (docs/adr/0009) so the
 * document format has a home neither the CLI nor a future server build
 * worker has to depend on the whole editor SPA to read. `projectStore.ts`
 * re-exports everything here; nothing outside that one file needed to
 * change import paths.
 */

/** A scene's fixed grid dimensions — a document-format fact, not a rendering one. `packages/editor/src/canvas/gridConstants.ts`'s own `TILE_SIZE` (a pixel/rendering concern) stays there. */
export const GRID_WIDTH = 20;
export const GRID_HEIGHT = 15;

export function emptyTiles(): number[] {
  return new Array(GRID_WIDTH * GRID_HEIGHT).fill(0);
}

/**
 * One choice out of a `DialogueTreeNode` — field-for-field the same shape
 * `@forge/dialogue`'s own `DialogueChoiceConfig` declares.
 * `next` indexes into the owning tree's own `nodes` array; `-1` ends the
 * dialogue.
 */
export interface DialogueTreeChoice {
  readonly id: string;
  readonly text: string;
  readonly next: number;
}

/**
 * A single line in a branching conversation — field-for-field the same
 * shape `@forge/dialogue`'s own `DialogueNodeConfig` declares
 * (docs/adr/0018 Decision 2): `speaker`, `text`, an optional `locale`, an
 * optional `choices` array, an optional `autoAdvanceSec`.
 *
 * This ADR's own text called for a direct type alias of
 * `DialogueNodeConfig` rather than a duplicate declaration — `@forge/dialogue`
 * is built against `@forge/module-api` only regardless of who else imports
 * its plain types, so `project-export` carries none of `GraphDocument`'s
 * module-boundary restriction. That plan hit a real, discovered-while-
 * implementing snag: `DialogueChoiceConfig`'s own `choices` field (and
 * `EntityDialogue.nodes` below) is a `readonly` array, and `ProjectCommand`
 * values carrying an `EntityDialogue` flow through Immer's
 * `set((state) => ...)` drafts (`projectStore.ts`) — Immer's `Draft<T>`
 * cannot map a `readonly` array field nested inside a discriminated-union-
 * typed command into its own mutable draft array type, so a direct alias
 * doesn't typecheck against the store's own command union. Independently
 * declaring this shape (mutable `choices` array, otherwise identical)
 * sidesteps that constraint the same way `GraphDocument`'s own doc comment
 * already accepts for a different reason — still a type-only mirror kept
 * in sync by hand, just for an Immer-compatibility reason instead of a
 * module-boundary one.
 */
export interface DialogueTreeNode {
  readonly speaker: string;
  readonly text: string;
  readonly locale?: string;
  /** Mutable array — see this interface's own doc comment for why (Immer draft compatibility, not an editing-pattern statement). Omit or leave empty to end the dialogue after this line. */
  choices?: DialogueTreeChoice[];
  /** Seconds before auto-advancing to `choices[0]` (or ending, if there are no choices). Omit to require an explicit "dialogue:choose"/"dialogue:advance" event. */
  readonly autoAdvanceSec?: number;
}

/**
 * A full branching conversation authored on one entity (docs/adr/0018
 * Decision 2) — replaces the pre-ADR `{speaker, text}` one-liner.
 * Deliberately has no `id` field of its own: the exported
 * `@forge/dialogue` tree's `id` is always synthesized as the owning
 * `EntityPlacement.id` at export time (`buildDialogueTreesFromEntities`,
 * `moduleAdapters.ts`) — the same `treeId == placementId` convention
 * `PreviewApp.tsx`'s `rebuildDialogueRuntime` and `@forge/player`'s
 * `gameLogic.ts` already rely on. A second, independently-authored id
 * here could only ever agree with or silently diverge from that
 * convention; not carrying one avoids the divergence case entirely.
 */
export interface EntityDialogue {
  /**
   * A plain mutable array, not `readonly DialogueTreeNode[]` — matching
   * `GraphDocument.nodes`/`SceneSummary.entities`/`.tiles`'s own
   * convention, and for the identical mechanical reason: `ProjectCommand`
   * values flow through Immer's `set((state) => ...)` drafts
   * (`projectStore.ts`), and Immer's `Draft<T>` cannot map a `readonly`
   * array field inside a discriminated-union-typed command into its own
   * mutable draft array type. Edited wholesale via the existing
   * `entity/configure` command either way (M10 is a whole-tree form, not
   * a node-CRUD canvas like `GraphEditorDialog`'s) — this is a type-
   * system constraint, not a statement that per-node mutation happens
   * here.
   */
  nodes: DialogueTreeNode[];
}

export interface EntityPlacement {
  readonly id: string;
  /** References a `Prefab` (`@forge/core`) by id — not a closed union, per docs/adr/0015-entity-prefab-component-model.md. */
  readonly prefabId: string;
  readonly tileX: number;
  readonly tileY: number;
  /** Only meaningful for a prefab whose entity can speak — today, `"npc"` — the one-line dialogue it says on interact (Phase 7). */
  readonly dialogue?: EntityDialogue;
}

export interface SceneSummary {
  readonly id: string;
  readonly name: string;
  /**
   * Not `readonly EntityPlacement[]`: mirrors `ProjectDocument.scenes`
   * itself, a plain mutable array holding readonly-fielded objects —
   * the editor's `applyCommand` mutates the array in place (push/splice),
   * while individual entities are replaced wholesale on change, never
   * patched.
   */
  entities: EntityPlacement[];
  /** Row-major (`y * GRID_WIDTH + x`), one tile id per cell. */
  tiles: number[];
}

/**
 * A module's config values, plus — only for a marketplace-sourced module —
 * the published version, bundle URL, and bundle hash it was installed at.
 * First-party modules never carry `marketplace`: their version and guest
 * bundle are resolved from `packages/player`'s own `node_modules` at
 * export time, the same as before this field existed. A marketplace
 * package has no local `node_modules` entry to resolve either from, so it
 * must pin both explicitly at install time instead. `bundleSha256Hex`
 * travels all the way to `forge export`'s own HTTP fetch of `bundleUrl`
 * (packages/cli/src/commands/export.ts), which verifies the fetched bytes
 * against it before feeding them to the sandbox — the CLI/build-time
 * equivalent of the Subresource-Integrity check the runtime already gets
 * for browser-side dependency loading (`DependencyResolver.cs`).
 */
export interface InstalledModuleEntry {
  readonly config: Record<string, string | number | boolean>;
  readonly marketplace?: { readonly version: string; readonly bundleUrl: string; readonly bundleSha256Hex: string };
}

/**
 * What a brand-new project starts with. `@forge/dialogue` and
 * `@forge/inventory` are first-party modules Forge itself ships — there is
 * no marketplace listing or "install" affordance for either yet in the
 * Modules panel — and the M4 exit criterion ("a first-time user builds a
 * walkable two-room map with a talking NPC in under 10 minutes, unaided")
 * depends on authoring dialogue on an NPC working without a detour through
 * module management first. Presence in `installedModules` is still the
 * real, load-bearing flag it always was: a creator who explicitly
 * uninstalls either (`uninstallModule`) gets exactly what that implies —
 * the live preview stops running it (`PreviewApp.tsx`'s own
 * `installedModules`-gated wiring), and `toExportProjectInput` refuses to
 * export a scene that still authors dialogue without the module installed
 * rather than silently dropping it (issue #123: preview and export must
 * agree on what "installed" means, not just export).
 */
export const DEFAULT_INSTALLED_MODULES: Record<string, InstalledModuleEntry> = {
  "@forge/dialogue": { config: {} },
  "@forge/inventory": { config: {} },
  /**
   * docs/adr/0017 (J1's node-graph authoring layer). Default-installed for
   * the same reason dialogue/inventory are: M6's own exit criterion is a
   * non-programmer building a mechanic via the graph editor alone, and
   * that can't require a manual "install this module first" detour before
   * `GraphsPanel` does anything. Safe with zero authored graphs, too —
   * `@forge/graph-runtime`'s `setup()` degrades to "register the core node
   * types, attach nothing" when `config.graphs` is empty (see its own doc
   * comment in `packages/modules/graph-runtime/src/index.ts`).
   */
  "@forge/graph-runtime": { config: {} },
  /**
   * docs/adr/0018 Decision 1 (J1's quest system). Default-installed for the
   * identical reason `@forge/graph-runtime` is: `QuestsPanel` (M8) needs to
   * work without a manual "install this module first" detour, and it's
   * safe with zero authored quests — `@forge/quests`' own `setup()`
   * degrades to "register no `Quest_<id>` components" when `config.quests`
   * is empty (`packages/modules/quests/src/index.ts`'s own `validateQuests`).
   */
  "@forge/quests": { config: {} },
};

/**
 * One placed node in an authored graph — docs/adr/0017 Decision 1's "the
 * editor's own React Flow document (nodes, typed sockets, edges, per-node
 * config values)... is JSON." `type` matches a `GraphNodeDefinition.type`
 * from `@forge/graph-nodes-core` (M2) or, once M4 ships, a third-party
 * module's own registered node type — this package never imports either,
 * so it stays a plain string here, the same "referenced by id, not by
 * import" relationship `EntityPlacement.prefabId` already has with
 * `@forge/core`'s prefab registry.
 */
export interface GraphNodeInstance {
  readonly id: string;
  readonly type: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly config: Readonly<Record<string, unknown>>;
}

/** One wire between two node sockets, addressed by node id + the socket's own `name` (`GraphSocketDefinition.name`) on each side. */
export interface GraphEdgeInstance {
  readonly id: string;
  readonly source: string;
  readonly sourceHandle: string;
  readonly target: string;
  readonly targetHandle: string;
}

/**
 * A project can have many graphs (docs/adr/0017 Decision 2 — one quest,
 * one mechanic, one branching dialogue tree each) — this is one of them,
 * not the whole authored set.
 */
export interface GraphDocument {
  readonly id: string;
  readonly name: string;
  /** Mutable arrays holding readonly-fielded elements — same convention as `SceneSummary.entities`/`.tiles`: the editor's `applyCommand` pushes/splices in place; individual elements are replaced wholesale on change, never patched. */
  nodes: GraphNodeInstance[];
  edges: GraphEdgeInstance[];
}

/**
 * A quest's *static* shape, authored once in `QuestsPanel` (M8) — the
 * dynamic half (is it active, which objectives are done) is owned by
 * `@forge/quests` itself at runtime (docs/adr/0018 Decision 1), not
 * carried here. Field-for-field the same shape
 * `packages/modules/quests/src/types.ts`'s `QuestObjectiveConfig`/
 * `QuestDefinitionConfig` declare — a type-only mirror across the
 * module-boundary line, the same relationship `DialogueTree` above has
 * with `@forge/dialogue`'s own `DialogueTreeConfig`.
 */
export interface QuestObjective {
  readonly id: string;
  readonly description: string;
}

export interface QuestDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Mutable array holding readonly-fielded elements — same convention as `GraphDocument.nodes`/`.edges`: the editor's `applyCommand` pushes/splices in place; individual elements are replaced wholesale on change, never patched. */
  objectives: QuestObjective[];
}

/**
 * A data table's authored shape (docs/adr/0018 Decision 3) — a small,
 * author-defined lookup table (drop tables, shop stock, stat curves,
 * localized strings keyed by id, etc.) a graph reads via `core:lookupRow`/
 * `core:tableRowCount`. Rows are plain JSON objects keyed by column name —
 * deliberately loose (`Record<string, unknown>`, not one union-typed field
 * per column) because a JSON-Schema-driven, per-column-typed row shape
 * would need the same generic-cell-editor machinery a full spreadsheet
 * component needs, and M12's own `DataTableEditorDialog` (TanStack Table)
 * is exactly that — the type here just carries what it produces, the same
 * "the document is a plain snapshot of whatever the editor built" relationship
 * every other `ProjectDocument` field already has to its own editor UI.
 *
 * `columns` is metadata for the editor (M12) and CSV import/export
 * (header order, declared type for a coherent CSV cell-parse) — nothing at
 * runtime reads it; `core:lookupRow`/`core:tableRowCount` only ever see
 * `rows` (via `SetupContext.dataTables`, which strips `columns`/`name`
 * before a table reaches a module — see `moduleAdapters.ts`).
 */
export interface DataTableColumn {
  readonly id: string;
  readonly name: string;
  readonly type: "number" | "string" | "boolean";
}

export interface DataTableDefinition {
  readonly id: string;
  readonly name: string;
  /** Mutable array holding readonly-fielded elements — same convention as `QuestDefinition.objectives`. */
  columns: DataTableColumn[];
  /** Mutable array of mutable plain-object rows — column id -> cell value. Not `readonly` for the same Immer-`Draft<T>`-inside-a-discriminated-union reason `DialogueTreeNode.choices` isn't (docs/adr/0018 Addendum M9): a `readonly` array or a `readonly`-fielded row nested in `ProjectCommand`'s union breaks `projectStore.ts`'s Immer draft typing. */
  rows: Record<string, unknown>[];
}

/** docs/SPEC.md Section 7.3's `activePack`/`packOverrides`/`packTerrainRemap`; see `packages/editor/src/store/projectStore.ts` for the full field-by-field rationale — unchanged by the move. */
export interface ProjectDocument {
  scenes: SceneSummary[];
  /** Installed module name -> its config (+ marketplace pin, if any). Presence of the key is the install flag. */
  installedModules: Record<string, InstalledModuleEntry>;
  activePack: string | undefined;
  packOverrides: Record<string, string>;
  packTerrainRemap: Record<string, string>;
  /** Graph id -> its document — docs/adr/0017 (J1's node-graph authoring layer, M3). */
  graphs: Record<string, GraphDocument>;
  /** Quest id -> its static definition — docs/adr/0018 Decision 1 (J1's quest system, M7). */
  quests: Record<string, QuestDefinition>;
  /** Data table id -> its authored definition — docs/adr/0018 Decision 3 (J1's data tables, M11). */
  dataTables: Record<string, DataTableDefinition>;
}

/**
 * A document persisted before `InstalledModuleEntry` existed stored each
 * installed module's config directly (`Record<string, string | number |
 * boolean>`), not wrapped in `{ config }` — this is exactly what
 * `InstalledModuleEntry` itself no longer is, since a real config value is
 * never an object. Used only to recognize that old shape during migration.
 */
type LegacyModuleConfig = Record<string, string | number | boolean>;

function isLegacyModuleConfig(value: LegacyModuleConfig | InstalledModuleEntry): value is LegacyModuleConfig {
  const config = (value as Partial<InstalledModuleEntry>).config;
  return typeof config !== "object" || config === null;
}

/** Migrates one `installedModules` entry from the pre-`InstalledModuleEntry` flat-config shape to the current one, wrapping it as `{ config: <the old value> }` — a first-party module re-saved under the old shape has no marketplace pin to lose, so this is a lossless upgrade. */
function migrateInstalledModuleEntry(value: LegacyModuleConfig | InstalledModuleEntry): InstalledModuleEntry {
  return isLegacyModuleConfig(value) ? { config: value } : value;
}

/**
 * A document persisted before `EntityPlacement.prefabId` existed carried
 * `kind: "player-start" | "npc"` instead — the pre-docs/adr/0015 shape.
 * `kind`'s value and `prefabId`'s value are the same strings by design
 * (`PLAYER_START_PREFAB.id === "player-start"`, `NPC_PREFAB.id === "npc"`
 * in `@forge/core`), so this migration is a pure field rename, not a value
 * remap — it changes no entity's rendered behavior.
 */
type LegacyEntityPlacement = Omit<EntityPlacement, "prefabId" | "dialogue"> & {
  readonly kind?: "player-start" | "npc";
  readonly dialogue?: EntityDialogue | LegacyEntityDialogue;
};

/**
 * A document persisted before docs/adr/0018 widened `EntityDialogue`
 * carried `{speaker, text}` directly — one line, no branching. Converting
 * it to a one-node tree with no `choices` is lossless: `@forge/dialogue`
 * already ends a dialogue after any node with no choices
 * (`dialogueModule`'s own `showNode`), the exact behavior a bare
 * `{speaker, text}` line always had.
 */
type LegacyEntityDialogue = { readonly speaker: string; readonly text: string };

function isLegacyEntityDialogue(dialogue: EntityDialogue | LegacyEntityDialogue): dialogue is LegacyEntityDialogue {
  return !("nodes" in dialogue);
}

function migrateEntityDialogue(dialogue: EntityDialogue | LegacyEntityDialogue | undefined): EntityDialogue | undefined {
  if (!dialogue) return undefined;
  if (isLegacyEntityDialogue(dialogue)) return { nodes: [{ speaker: dialogue.speaker, text: dialogue.text }] };
  return dialogue;
}

function migrateEntityPlacement(entity: LegacyEntityPlacement): EntityPlacement {
  const { kind, dialogue: legacyDialogue, ...rest } = entity;
  const existingPrefabId = (entity as Partial<EntityPlacement>).prefabId;
  const prefabId = typeof existingPrefabId === "string" ? existingPrefabId : (kind ?? "npc");
  const dialogue = migrateEntityDialogue(legacyDialogue);
  // exactOptionalPropertyTypes: only assign `dialogue` when there actually is one.
  return dialogue !== undefined ? { ...rest, prefabId, dialogue } : { ...rest, prefabId };
}

/**
 * Fills in any field a partial/foreign document is missing — used both by
 * the editor's own `persist` rehydration and to normalize a document
 * fetched from `GetDocumentEndpoint` (can be `undefined` entirely, or an
 * older schema version than this build expects). Moved here unchanged,
 * except for one addition: `document === undefined` (the whole document,
 * not just one field of it missing) is the one case genuinely
 * distinguishable from "an existing document that happens to have no
 * installed modules" — that's what a brand-new project with no revisions
 * yet looks like, and only that case gets `DEFAULT_INSTALLED_MODULES`. An
 * existing document that was legitimately saved with an empty
 * `installedModules` (or an older-format document simply missing that one
 * field while the rest of it is real, already-authored content) still
 * normalizes to `{}`, exactly as before — this migration only fills in
 * missing *shape*, never edits what an existing document actually decided.
 */
export function migrateDocument(document: Partial<ProjectDocument> | undefined): ProjectDocument {
  const installedModules = document?.installedModules ?? (document === undefined ? DEFAULT_INSTALLED_MODULES : {});
  return {
    scenes: (document?.scenes ?? []).map((scene) => ({
      ...scene,
      tiles: scene.tiles ?? emptyTiles(),
      entities: (scene.entities ?? []).map((entity) => migrateEntityPlacement(entity as LegacyEntityPlacement)),
    })),
    installedModules: Object.fromEntries(
      Object.entries(installedModules).map(([name, value]) => [name, migrateInstalledModuleEntry(value)]),
    ),
    activePack: document?.activePack,
    packOverrides: document?.packOverrides ?? {},
    packTerrainRemap: document?.packTerrainRemap ?? {},
    graphs: document?.graphs ?? {},
    quests: document?.quests ?? {},
    dataTables: document?.dataTables ?? {},
  };
}
