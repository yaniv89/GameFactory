/**
 * Shared between SceneCanvas (the paint surface) and the preview iframe
 * (packages/editor/src/preview) so both build a TilemapLayer of the same
 * dimensions without transmitting them over the postMessage bridge —
 * fewer moving parts in the wire protocol, and no way for the two to
 * silently disagree.
 *
 * GRID_WIDTH/GRID_HEIGHT are a document-format fact (a scene's fixed grid
 * size), not a rendering one — they live in @forge/project-export
 * (docs/adr/0009) and are re-exported here so nothing else in the editor
 * needs an import-path change. TILE_SIZE is purely a pixel/rendering
 * concern and stays local.
 */
export { GRID_HEIGHT, GRID_WIDTH } from "@forge/project-export";
export const TILE_SIZE = 32;
