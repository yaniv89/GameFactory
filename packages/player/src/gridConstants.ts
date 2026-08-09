/**
 * Matches `packages/editor/src/canvas/gridConstants.ts` exactly — the
 * editor has no per-scene grid-size concept yet (a fixed 20x15 board is
 * what `SceneCanvas`/the preview iframe/`PackSwapPreview` all assume), so
 * an exported project's tile data is laid out against the same fixed
 * dimensions. Duplicated rather than imported for the same reason
 * `gameWorld.ts` is: the player package cannot depend on the editor app.
 */
export const GRID_WIDTH = 20;
export const GRID_HEIGHT = 15;
export const TILE_SIZE = 32;
