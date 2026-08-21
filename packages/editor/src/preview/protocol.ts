import { isPrefabId } from "@forge/core";
import type { GraphDocument, QuestDefinition } from "@forge/project-export";
import { GRID_HEIGHT, GRID_WIDTH } from "../canvas/gridConstants";
import type { EntityPlacement } from "../store/projectStore";
import { isValidDevPreviewSave, type DevPreviewSave } from "./devPreviewSave";

/**
 * The entire wire protocol between the editor (app.forge.dev, in
 * production) and the preview iframe (play.forge.dev / a per-game
 * subdomain — docs/SPEC.md 10.6). Deliberately narrow and typed: this is
 * the only shape either side is allowed to act on, and every field is
 * validated before use, never `eval`'d or otherwise trusted blindly
 * (CLAUDE.md 1.1.2). No secrets or tokens ever belong in these messages
 * (CLAUDE.md 4.7) — only project content, same as what a save file holds.
 *
 * `entities` reuses projectStore's `EntityPlacement` type directly (a
 * type-only import — no runtime coupling to Zustand) rather than
 * declaring a parallel shape: it's already exactly the wire-safe,
 * serializable data the message needs to carry.
 */
export interface PreviewSceneMessage {
  readonly type: "forge:preview:scene";
  readonly tiles: readonly number[];
  readonly entities: readonly EntityPlacement[];
  /** `ProjectDocument.activePack` — undefined when no Art Pack is installed. The preview resolves real character/tile art against this itself (`characterTextures.ts`/`packTiles.ts`); a pack name a client sends is still just a hint like any other field here, never trusted beyond "which pack to fetch and validate." */
  readonly activePack?: string;
  /**
   * `Object.keys(ProjectDocument.installedModules)` — issue #123: the live
   * preview used to run `@forge/dialogue`/`@forge/inventory`
   * unconditionally regardless of install status, while `forge export`
   * (`toExportProjectInput.ts`) only ever included a module actually
   * present here. A creator who uninstalled dialogue would see it keep
   * working in preview and then silently vanish on export — this field is
   * what lets `PreviewApp.tsx` check the same real flag export already
   * does, so both sides agree on what "installed" means. Optional (like
   * `activePack`/`devSave` above) purely for wire-shape leniency — an
   * absent field means "nothing installed" (`PreviewApp.tsx` treats
   * `undefined` the same as `[]`), not "don't enforce this."
   */
  readonly installedModules?: readonly string[];
  /**
   * I1f: the last dev-preview save this browser has, if any —
   * `PreviewPanel.tsx` reads it once (`localStorage`, its own real
   * origin) and hands it to the preview here, since the sandboxed iframe
   * can't read `localStorage` itself (`devPreviewSave.ts`'s own doc
   * comment has the confirmed-empirically detail). Sent on the first
   * `forge:preview:scene` message after boot and consumed once on that
   * side (`PreviewApp.tsx`) — present on later messages is harmless, just
   * ignored.
   */
  readonly devSave?: DevPreviewSave;
  /**
   * `ProjectDocument.graphs` (docs/adr/0017, M6) — every authored graph in
   * the project, keyed by id, the same shape `forge export`'s own
   * `moduleAdapters.ts` assembles `@forge/graph-runtime`'s `config.graphs`
   * from. Optional like `activePack`/`devSave` above: an absent field
   * means "no graphs authored yet," not "don't run the graph module."
   */
  readonly graphs?: Readonly<Record<string, GraphDocument>>;
  /**
   * `ProjectDocument.dataTables` (docs/adr/0018 Decision 3, M11), rows
   * only — the same shape `toExportProjectInput.ts` strips a
   * `DataTableDefinition` down to (no `columns`/`name`; nothing at
   * runtime reads those). Optional like `graphs` above: an absent field
   * means "no tables authored yet," not "clear whatever the module
   * already has" — there is no live-update path for this today (like
   * `graphs`, a changed table only takes effect on the next
   * `rebuildGraphRuntime`-style full rebuild, not a hot patch).
   */
  readonly dataTables?: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  /**
   * `ProjectDocument.quests` (docs/adr/0018 Decision 1, M7) — every
   * authored quest's static definition, keyed by id, the same shape
   * `forge export`'s own `moduleAdapters.ts` assembles `@forge/quests`'
   * `config.quests` from. Optional like `graphs`/`dataTables` above: an
   * absent field means "no quests authored yet." Unlike `graphs`, which
   * `PreviewApp.tsx` re-attaches fresh on every scene message, quest
   * definitions can only be read once, on the *first* scene message this
   * preview session receives — `@forge/quests` registers one real ECS
   * component per quest (`ctx.defineComponent`) against the live
   * preview's own persistent, shared game world, and a component type
   * can never be redefined on the same world twice
   * (`ComponentRegistry.define` throws "already registered" — see
   * `PreviewApp.tsx`'s own doc comment on `questRuntimeAttachedRef`).
   * Editing an already-running preview session's quests takes effect on
   * the next full preview reload, not live — an honest, structural
   * limitation, not an oversight.
   */
  readonly quests?: Readonly<Record<string, QuestDefinition>>;
}

export interface PreviewReadyMessage {
  readonly type: "forge:preview:ready";
}

export interface PreviewErrorMessage {
  readonly type: "forge:preview:error";
  readonly message: string;
}

/**
 * I1f: the preview's own save trigger (`beforeunload`/periodic/unmount —
 * `PreviewApp.tsx`'s own doc comment) ships the save data *out* to the
 * parent, which is the only side of this bridge with a real, storable
 * origin — see `PreviewSceneMessage.devSave`'s own doc comment for the
 * reverse direction.
 */
export interface PreviewSaveMessage {
  readonly type: "forge:preview:save";
  readonly save: DevPreviewSave;
}

/** Editor -> preview. */
export type EditorToPreviewMessage = PreviewSceneMessage;

/** Preview -> editor. */
export type PreviewToEditorMessage = PreviewReadyMessage | PreviewErrorMessage | PreviewSaveMessage;

const EXPECTED_TILE_COUNT = GRID_WIDTH * GRID_HEIGHT;

/** One choice out of a `DialogueTreeNode` (docs/adr/0018 Decision 2) — `{id, text, next}`. */
function isValidDialogueChoice(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.text === "string" && typeof candidate.next === "number" && Number.isFinite(candidate.next);
}

/** One line of a `DialogueTreeNode` — `speaker`/`text` required, `choices`/`locale`/`autoAdvanceSec` optional. */
function isValidDialogueNode(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.speaker !== "string" || typeof candidate.text !== "string") return false;
  if (candidate.locale !== undefined && typeof candidate.locale !== "string") return false;
  if (candidate.autoAdvanceSec !== undefined && typeof candidate.autoAdvanceSec !== "number") return false;
  if (candidate.choices !== undefined) {
    if (!Array.isArray(candidate.choices) || !candidate.choices.every(isValidDialogueChoice)) return false;
  }
  return true;
}

function isValidEntity(value: unknown): value is EntityPlacement {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string") return false;
  if (!isPrefabId(candidate.prefabId)) return false;
  if (typeof candidate.tileX !== "number" || !Number.isFinite(candidate.tileX)) return false;
  if (typeof candidate.tileY !== "number" || !Number.isFinite(candidate.tileY)) return false;
  if (candidate.dialogue !== undefined) {
    if (typeof candidate.dialogue !== "object" || candidate.dialogue === null) return false;
    const dialogue = candidate.dialogue as Record<string, unknown>;
    // docs/adr/0018 Decision 2: a real branching tree, not a one-liner —
    // at least one node, every node individually well-formed.
    if (!Array.isArray(dialogue.nodes) || dialogue.nodes.length === 0) return false;
    if (!dialogue.nodes.every(isValidDialogueNode)) return false;
  }
  return true;
}

function isValidGraphNodeInstance(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.type === "string" && typeof candidate.config === "object" && candidate.config !== null;
}

function isValidGraphEdgeInstance(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.source === "string" &&
    typeof candidate.sourceHandle === "string" &&
    typeof candidate.target === "string" &&
    typeof candidate.targetHandle === "string"
  );
}

function isValidGraphDocument(value: unknown): value is GraphDocument {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string") return false;
  if (!Array.isArray(candidate.nodes) || !candidate.nodes.every(isValidGraphNodeInstance)) return false;
  if (!Array.isArray(candidate.edges) || !candidate.edges.every(isValidGraphEdgeInstance)) return false;
  return true;
}

function isValidDataTableRows(value: unknown): value is readonly Readonly<Record<string, unknown>>[] {
  return Array.isArray(value) && value.every((row) => typeof row === "object" && row !== null && !Array.isArray(row));
}

function isValidQuestObjective(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && typeof candidate.description === "string";
}

function isValidQuestDefinition(value: unknown): value is QuestDefinition {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string" || typeof candidate.description !== "string") return false;
  return Array.isArray(candidate.objectives) && candidate.objectives.every(isValidQuestObjective);
}

export function isPreviewSceneMessage(data: unknown): data is PreviewSceneMessage {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as {
    type?: unknown;
    tiles?: unknown;
    entities?: unknown;
    activePack?: unknown;
    devSave?: unknown;
    installedModules?: unknown;
    graphs?: unknown;
    dataTables?: unknown;
    quests?: unknown;
  };
  if (candidate.type !== "forge:preview:scene") return false;
  if (!Array.isArray(candidate.tiles) || candidate.tiles.length !== EXPECTED_TILE_COUNT) return false;
  if (!candidate.tiles.every((tile) => typeof tile === "number" && Number.isFinite(tile))) return false;
  if (!Array.isArray(candidate.entities)) return false;
  if (candidate.activePack !== undefined && typeof candidate.activePack !== "string") return false;
  if (candidate.devSave !== undefined && !isValidDevPreviewSave(candidate.devSave)) return false;
  if (candidate.installedModules !== undefined) {
    if (!Array.isArray(candidate.installedModules) || !candidate.installedModules.every((name) => typeof name === "string")) return false;
  }
  if (candidate.graphs !== undefined) {
    if (typeof candidate.graphs !== "object" || candidate.graphs === null) return false;
    if (!Object.values(candidate.graphs).every(isValidGraphDocument)) return false;
  }
  if (candidate.dataTables !== undefined) {
    if (typeof candidate.dataTables !== "object" || candidate.dataTables === null) return false;
    if (!Object.values(candidate.dataTables).every(isValidDataTableRows)) return false;
  }
  if (candidate.quests !== undefined) {
    if (typeof candidate.quests !== "object" || candidate.quests === null) return false;
    if (!Object.values(candidate.quests).every(isValidQuestDefinition)) return false;
  }
  return candidate.entities.every(isValidEntity);
}

export function isPreviewToEditorMessage(data: unknown): data is PreviewToEditorMessage {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as { type?: unknown; message?: unknown; save?: unknown };
  if (candidate.type === "forge:preview:ready") return true;
  if (candidate.type === "forge:preview:error") return typeof candidate.message === "string";
  if (candidate.type === "forge:preview:save") return isValidDevPreviewSave(candidate.save);
  return false;
}
