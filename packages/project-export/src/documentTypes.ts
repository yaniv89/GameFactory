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

export interface EntityDialogue {
  readonly speaker: string;
  readonly text: string;
}

export interface EntityPlacement {
  readonly id: string;
  readonly kind: "player-start" | "npc";
  readonly tileX: number;
  readonly tileY: number;
  /** Only meaningful for `kind: "npc"` — the one-line dialogue it says on interact (Phase 7). */
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

/** docs/SPEC.md Section 7.3's `activePack`/`packOverrides`/`packTerrainRemap`; see `packages/editor/src/store/projectStore.ts` for the full field-by-field rationale — unchanged by the move. */
export interface ProjectDocument {
  scenes: SceneSummary[];
  /** Installed module name -> its config values. Presence of the key is the install flag. */
  installedModules: Record<string, Record<string, string | number | boolean>>;
  activePack: string | undefined;
  packOverrides: Record<string, string>;
  packTerrainRemap: Record<string, string>;
}

/**
 * Fills in any field a partial/foreign document is missing — used both by
 * the editor's own `persist` rehydration and to normalize a document
 * fetched from `GetDocumentEndpoint` (can be `undefined` entirely, or an
 * older schema version than this build expects). Moved here unchanged.
 */
export function migrateDocument(document: Partial<ProjectDocument> | undefined): ProjectDocument {
  return {
    scenes: (document?.scenes ?? []).map((scene) => ({ ...scene, tiles: scene.tiles ?? emptyTiles() })),
    installedModules: document?.installedModules ?? {},
    activePack: document?.activePack,
    packOverrides: document?.packOverrides ?? {},
    packTerrainRemap: document?.packTerrainRemap ?? {},
  };
}
