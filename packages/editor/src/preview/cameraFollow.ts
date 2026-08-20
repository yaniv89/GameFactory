import type { Camera } from "@forge/render-2d";

/**
 * How much closer than "the whole map fits in the panel" (`fitZoom`) the
 * follow camera sits — a played scene reads as a game at a character's own
 * scale, not as a zoomed-out level-editor overview of a two-room map.
 * Picked to comfortably frame the player and nearby NPCs on this repo's
 * own 20x15 grid (`gridConstants.ts`); H1g's larger, multi-layer maps may
 * want their own tuning, not assumed to be this same constant forever.
 */
export const CAMERA_FOLLOW_ZOOM_FACTOR = 2;

/** The zoom level that fits a `worldWidth`x`worldHeight` world exactly into a `viewportWidth`x`viewportHeight` viewport, letterboxed on the shorter axis. */
export function fitZoom(viewportWidth: number, viewportHeight: number, worldWidth: number, worldHeight: number): number {
  if (worldWidth <= 0 || worldHeight <= 0) return 1;
  return Math.min(viewportWidth / worldWidth, viewportHeight / worldHeight);
}

/** `fitZoom`, tightened by `CAMERA_FOLLOW_ZOOM_FACTOR` — the zoom the camera-follow view uses once a player exists to follow. */
export function followZoom(viewportWidth: number, viewportHeight: number, worldWidth: number, worldHeight: number): number {
  return fitZoom(viewportWidth, viewportHeight, worldWidth, worldHeight) * CAMERA_FOLLOW_ZOOM_FACTOR;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Centers `camera` on `(targetX, targetY)`, clamped so the viewport never
 * shows past the map's own edges into empty space — standard top-down
 * camera-follow. Falls back to dead-centering the map on whichever axis
 * the current zoom shows more of than the map actually has (a viewport
 * wider/taller than the whole world, e.g. before a player exists and the
 * camera is still at `fitZoom`), rather than clamping a `min` above a
 * `max` and letting `Math.max`/`Math.min` silently pick the wrong one.
 */
export function followCamera(camera: Camera, targetX: number, targetY: number, worldWidth: number, worldHeight: number): void {
  const bounds = camera.visibleWorldBounds();
  const halfViewWidth = (bounds.right - bounds.left) / 2;
  const halfViewHeight = (bounds.bottom - bounds.top) / 2;
  camera.x = halfViewWidth * 2 >= worldWidth ? worldWidth / 2 : clamp(targetX, halfViewWidth, worldWidth - halfViewWidth);
  camera.y = halfViewHeight * 2 >= worldHeight ? worldHeight / 2 : clamp(targetY, halfViewHeight, worldHeight - halfViewHeight);
}
