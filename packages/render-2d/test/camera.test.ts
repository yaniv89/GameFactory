import { describe, expect, it } from "vitest";
import { Camera } from "../src/camera";

function makeTarget() {
  return { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 } };
}

describe("Camera", () => {
  it("centers the viewport on (camera.x, camera.y) at zoom 1", () => {
    const camera = new Camera({ viewportWidth: 960, viewportHeight: 540, pixelPerfect: false });
    camera.x = 100;
    camera.y = 50;

    const target = makeTarget();
    camera.applyTo(target);

    expect(target.position.x).toBeCloseTo(960 / 2 - 100);
    expect(target.position.y).toBeCloseTo(540 / 2 - 50);
    expect(target.scale.x).toBe(1);
    expect(target.scale.y).toBe(1);
  });

  it("scales the world container by zoom", () => {
    const camera = new Camera({ viewportWidth: 960, viewportHeight: 540, pixelPerfect: false });
    camera.zoom = 2;

    const target = makeTarget();
    camera.applyTo(target);

    expect(target.scale.x).toBe(2);
    expect(target.scale.y).toBe(2);
  });

  it("snaps the applied transform to whole pixels when pixelPerfect is true", () => {
    const camera = new Camera({ viewportWidth: 960, viewportHeight: 540, pixelPerfect: true });
    camera.x = 100.4;
    camera.y = 50.6;

    const target = makeTarget();
    camera.applyTo(target);

    expect(Number.isInteger(target.position.x)).toBe(true);
    expect(Number.isInteger(target.position.y)).toBe(true);
  });

  it("does not snap when pixelPerfect is false", () => {
    const camera = new Camera({ viewportWidth: 960, viewportHeight: 540, pixelPerfect: false });
    camera.x = 100.4;

    const target = makeTarget();
    camera.applyTo(target);

    expect(target.position.x).toBeCloseTo(960 / 2 - 100.4);
  });

  it("worldToScreen and screenToWorld are inverses", () => {
    const camera = new Camera({ viewportWidth: 960, viewportHeight: 540, pixelPerfect: false });
    camera.x = 320;
    camera.y = 180;
    camera.zoom = 1.5;

    const screen = camera.worldToScreen(400, 250);
    const world = camera.screenToWorld(screen.x, screen.y);

    expect(world.x).toBeCloseTo(400);
    expect(world.y).toBeCloseTo(250);
  });

  it("visibleWorldBounds shrinks as zoom increases", () => {
    const camera = new Camera({ viewportWidth: 960, viewportHeight: 540, pixelPerfect: false });
    camera.zoom = 1;
    const boundsAt1x = camera.visibleWorldBounds();

    camera.zoom = 2;
    const boundsAt2x = camera.visibleWorldBounds();

    expect(boundsAt2x.right - boundsAt2x.left).toBeCloseTo((boundsAt1x.right - boundsAt1x.left) / 2);
  });

  it("visibleWorldBounds grows with the requested margin", () => {
    const camera = new Camera({ viewportWidth: 960, viewportHeight: 540, pixelPerfect: false });
    const noMargin = camera.visibleWorldBounds(0);
    const withMargin = camera.visibleWorldBounds(32);

    expect(withMargin.left).toBeLessThan(noMargin.left);
    expect(withMargin.right).toBeGreaterThan(noMargin.right);
  });

  it("updates the viewport used for centering after resizeViewport", () => {
    const camera = new Camera({ viewportWidth: 960, viewportHeight: 540, pixelPerfect: false });
    camera.resizeViewport(1920, 1080);

    const target = makeTarget();
    camera.applyTo(target);

    expect(target.position.x).toBeCloseTo(1920 / 2);
    expect(target.position.y).toBeCloseTo(1080 / 2);
  });
});
