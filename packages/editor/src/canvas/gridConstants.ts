/**
 * Shared between SceneCanvas (the paint surface) and the preview iframe
 * (packages/editor/src/preview) so both build a TilemapLayer of the same
 * dimensions without transmitting them over the postMessage bridge —
 * fewer moving parts in the wire protocol, and no way for the two to
 * silently disagree.
 */
export const GRID_WIDTH = 20;
export const GRID_HEIGHT = 15;
export const TILE_SIZE = 32;
