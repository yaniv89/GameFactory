import { GRID_HEIGHT, GRID_WIDTH } from "../canvas/gridConstants";

/**
 * The entire wire protocol between the editor (app.forge.dev, in
 * production) and the preview iframe (play.forge.dev / a per-game
 * subdomain — docs/SPEC.md 10.6). Deliberately narrow and typed: this is
 * the only shape either side is allowed to act on, and every field is
 * validated before use, never `eval`'d or otherwise trusted blindly
 * (CLAUDE.md 1.1.2). No secrets or tokens ever belong in these messages
 * (CLAUDE.md 4.7) — only project content, same as what a save file holds.
 */
export interface PreviewTilesMessage {
  readonly type: "forge:preview:tiles";
  readonly tiles: readonly number[];
}

export interface PreviewReadyMessage {
  readonly type: "forge:preview:ready";
}

export interface PreviewErrorMessage {
  readonly type: "forge:preview:error";
  readonly message: string;
}

/** Editor -> preview. */
export type EditorToPreviewMessage = PreviewTilesMessage;

/** Preview -> editor. */
export type PreviewToEditorMessage = PreviewReadyMessage | PreviewErrorMessage;

const EXPECTED_TILE_COUNT = GRID_WIDTH * GRID_HEIGHT;

export function isPreviewTilesMessage(data: unknown): data is PreviewTilesMessage {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as { type?: unknown; tiles?: unknown };
  if (candidate.type !== "forge:preview:tiles") return false;
  if (!Array.isArray(candidate.tiles) || candidate.tiles.length !== EXPECTED_TILE_COUNT) return false;
  return candidate.tiles.every((tile) => typeof tile === "number" && Number.isFinite(tile));
}

export function isPreviewToEditorMessage(data: unknown): data is PreviewToEditorMessage {
  if (typeof data !== "object" || data === null) return false;
  const candidate = data as { type?: unknown; message?: unknown };
  if (candidate.type === "forge:preview:ready") return true;
  if (candidate.type === "forge:preview:error") return typeof candidate.message === "string";
  return false;
}
