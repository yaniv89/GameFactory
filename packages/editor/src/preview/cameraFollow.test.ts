import { Camera } from "@forge/render-2d";
import { describe, expect, it } from "vitest";
import { CAMERA_FOLLOW_ZOOM_FACTOR, fitZoom, followCamera, followZoom } from "./cameraFollow";

const WORLD_WIDTH = 640; // 20 tiles * 32px
const WORLD_HEIGHT = 480; // 15 tiles * 32px

describe("fitZoom / followZoom", () => {
  it("fitZoom picks the tighter axis so the whole world fits without cropping", () => {
    // Viewport wider than the world's own aspect ratio -> height is the binding constraint.
    expect(fitZoom(2000, 480, WORLD_WIDTH, WORLD_HEIGHT)).toBeCloseTo(1, 5);
    // Viewport narrower -> width is the binding constraint.
    expect(fitZoom(320, 2000, WORLD_WIDTH, WORLD_HEIGHT)).toBeCloseTo(0.5, 5);
  });

  it("followZoom is exactly CAMERA_FOLLOW_ZOOM_FACTOR times fitZoom", () => {
    const viewport = { w: 640, h: 480 };
    expect(followZoom(viewport.w, viewport.h, WORLD_WIDTH, WORLD_HEIGHT)).toBeCloseTo(
      fitZoom(viewport.w, viewport.h, WORLD_WIDTH, WORLD_HEIGHT) * CAMERA_FOLLOW_ZOOM_FACTOR,
      10,
    );
  });
});

function makeCamera(zoom: number): Camera {
  const camera = new Camera({ viewportWidth: 320, viewportHeight: 240 });
  camera.zoom = zoom;
  return camera;
}

describe("followCamera", () => {
  it("centers exactly on the target when the target is well inside the map, away from every edge", () => {
    const camera = makeCamera(1); // 320x240 world units visible
    followCamera(camera, 320, 240, WORLD_WIDTH, WORLD_HEIGHT);
    expect(camera.x).toBe(320);
    expect(camera.y).toBe(240);
  });

  it("clamps the camera at the map's left/top edge instead of showing space beyond it", () => {
    const camera = makeCamera(1); // half-view 160x120
    followCamera(camera, 10, 5, WORLD_WIDTH, WORLD_HEIGHT);
    expect(camera.x).toBe(160); // clamped to halfViewWidth
    expect(camera.y).toBe(120); // clamped to halfViewHeight
  });

  it("clamps the camera at the map's right/bottom edge instead of showing space beyond it", () => {
    const camera = makeCamera(1); // half-view 160x120
    followCamera(camera, WORLD_WIDTH - 5, WORLD_HEIGHT - 5, WORLD_WIDTH, WORLD_HEIGHT);
    expect(camera.x).toBe(WORLD_WIDTH - 160); // clamped to worldWidth - halfViewWidth
    expect(camera.y).toBe(WORLD_HEIGHT - 120); // clamped to worldHeight - halfViewHeight
  });

  it("dead-centers on an axis where the viewport already shows more than the whole map", () => {
    // zoom small enough that half the view (per axis) exceeds half the world.
    const camera = makeCamera(0.1); // half-view: 1600x1200, both > world halves (320x240)
    followCamera(camera, 999, 999, WORLD_WIDTH, WORLD_HEIGHT); // way outside the map, should not matter
    expect(camera.x).toBe(WORLD_WIDTH / 2);
    expect(camera.y).toBe(WORLD_HEIGHT / 2);
  });
});
