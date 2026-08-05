/** Anything the camera can drive: a Pixi Container's position/scale, or a fake in tests. */
export interface CameraTarget {
  position: { x: number; y: number };
  scale: { x: number; y: number };
}

export interface CameraBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface CameraOptions {
  viewportWidth: number;
  viewportHeight: number;
  /** Snap the applied transform to whole device pixels. Avoids pixel-art shimmer. Default true, per project settings' `pixelPerfect`. */
  pixelPerfect?: boolean;
}

/**
 * World-space camera for the 2D top-down view. Owns no display objects
 * itself — `applyTo()` writes the resulting transform onto whatever
 * Container the caller designates as the "world" layer, per
 * docs/SPEC.md Section 8.3 (`PreRender`: "Transform interpolation, camera,
 * culling").
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;

  private viewportWidth: number;
  private viewportHeight: number;
  private readonly pixelPerfect: boolean;

  constructor(options: CameraOptions) {
    this.viewportWidth = options.viewportWidth;
    this.viewportHeight = options.viewportHeight;
    this.pixelPerfect = options.pixelPerfect ?? true;
  }

  resizeViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  /** Writes this camera's transform onto `target` (the world container). */
  applyTo(target: CameraTarget): void {
    let screenX = this.viewportWidth / 2 - this.x * this.zoom;
    let screenY = this.viewportHeight / 2 - this.y * this.zoom;
    if (this.pixelPerfect) {
      screenX = Math.round(screenX);
      screenY = Math.round(screenY);
    }
    target.position.x = screenX;
    target.position.y = screenY;
    target.scale.x = this.zoom;
    target.scale.y = this.zoom;
  }

  worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: this.viewportWidth / 2 + (worldX - this.x) * this.zoom,
      y: this.viewportHeight / 2 + (worldY - this.y) * this.zoom,
    };
  }

  screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
    return {
      x: this.x + (screenX - this.viewportWidth / 2) / this.zoom,
      y: this.y + (screenY - this.viewportHeight / 2) / this.zoom,
    };
  }

  /** The world-space rectangle currently visible in the viewport. The basis for tilemap culling. */
  visibleWorldBounds(margin = 0): CameraBounds {
    const halfWidth = this.viewportWidth / 2 / this.zoom + margin;
    const halfHeight = this.viewportHeight / 2 / this.zoom + margin;
    return {
      left: this.x - halfWidth,
      top: this.y - halfHeight,
      right: this.x + halfWidth,
      bottom: this.y + halfHeight,
    };
  }
}
