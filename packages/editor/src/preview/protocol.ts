import { isPrefabId } from "@forge/core";
import { GRID_HEIGHT, GRID_WIDTH } from "../canvas/gridConstants";
import type { EntityPlacement } from "../store/projectStore";

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
}

export interface PreviewReadyMessage {
  readonly type: "forge:preview:ready";
}

export interface PreviewErrorMessage {
  readonly type: "forge:preview:error";
  readonly message: string;
}

/** Editor -> preview. */
export type EditorToPreviewMessage = PreviewSceneMessage;

/** Preview -> editor. */
export type PreviewToEditorMessage = PreviewReadyMessage | PreviewErrorMessage;

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

export function isPreviewSceneMessage(data: unknown): data is PreviewSceneMessage {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as { type?: unknown; tiles?: unknown; entities?: unknown };
  if (candidate.type !== "forge:preview:scene") return false;
  if (!Array.isArray(candidate.tiles) || candidate.tiles.length !== EXPECTED_TILE_COUNT) return false;
  if (!candidate.tiles.every((tile) => typeof tile === "number" && Number.isFinite(tile))) return false;
  if (!Array.isArray(candidate.entities)) return false;
  return candidate.entities.every(isValidEntity);
}

export function isPreviewToEditorMessage(data: unknown): data is PreviewToEditorMessage {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as { type?: unknown; message?: unknown };
  if (candidate.type === "forge:preview:ready") return true;
  if (candidate.type === "forge:preview:error") return typeof candidate.message === "string";
  return false;
}
