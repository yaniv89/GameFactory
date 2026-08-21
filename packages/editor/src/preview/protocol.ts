import { isPrefabId } from "@forge/core";
import type { GraphDocument } from "@forge/project-export";
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
    if (typeof dialogue.speaker !== "string" || typeof dialogue.text !== "string") return false;
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

export function isPreviewSceneMessage(data: unknown): data is PreviewSceneMessage {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as { type?: unknown; tiles?: unknown; entities?: unknown; activePack?: unknown; devSave?: unknown; installedModules?: unknown; graphs?: unknown };
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
