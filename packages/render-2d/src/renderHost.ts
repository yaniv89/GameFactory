import { Application, Container } from "pixi.js";

export interface RenderHostOptions {
  /** Provide an existing canvas (e.g. the editor's preview surface); omitted, Pixi creates one and appends it to `document.body`. */
  canvas?: HTMLCanvasElement;
  viewportWidth: number;
  viewportHeight: number;
  backgroundColor?: number;
}

/**
 * Boots the shared Pixi Application and owns the root display tree: one
 * `worldContainer` that the Camera (`camera.ts`) transforms, everything
 * else (tilemap layers, entity sprites) parented under it.
 */
export class RenderHost {
  readonly app: Application;
  readonly worldContainer: Container;
  private readonly ownsCanvas: boolean;

  private constructor(app: Application, worldContainer: Container, ownsCanvas: boolean) {
    this.app = app;
    this.worldContainer = worldContainer;
    this.ownsCanvas = ownsCanvas;
  }

  /**
   * Per CLAUDE.md Section 2.3 / docs/SPEC.md Section 8.1: "PixiJS v8
   * (WebGPU with WebGL2 fallback)". Pixi's own `autoDetectRenderer`
   * default order is `['webgl', 'webgpu', 'canvas']` — WebGL first — so
   * `preference` is set explicitly here rather than left to that default.
   * Canvas 2D is deliberately excluded from the fallback chain: it's an
   * order of magnitude too slow for the tile-heavy scenes this budget
   * assumes, so a browser with neither WebGPU nor WebGL2 should fail
   * loudly instead of silently rendering at an unplayable frame rate.
   */
  static async create(options: RenderHostOptions): Promise<RenderHost> {
    const app = new Application();
    await app.init({
      ...(options.canvas ? { canvas: options.canvas } : {}),
      width: options.viewportWidth,
      height: options.viewportHeight,
      backgroundColor: options.backgroundColor ?? 0x000000,
      preference: ["webgpu", "webgl"],
      antialias: false,
      resolution: 1,
      autoDensity: false,
    });

    // sortableChildren + per-sprite zIndex (createSpriteSyncSystem sets it
    // from each entity's own world-space y) is the actual Y-depth sort for
    // a top-down scene — an entity lower on screen draws in front of one
    // above it, tiles (never given a zIndex, default 0) always stay
    // behind every entity. A no-op for a caller that never sets zIndex
    // (SceneCanvas's own hand-rolled entity markers).
    const worldContainer = new Container({ label: "world", sortableChildren: true });
    app.stage.addChild(worldContainer);

    return new RenderHost(app, worldContainer, /* ownsCanvas */ !options.canvas);
  }

  /** Letterbox resize: called on window/container resize, per project settings' `viewport.scaleMode`. Actual letterbox math (scale-to-fit + centering) belongs to the editor/runtime host embedding this, which knows the outer element's size — this just retargets the renderer's own resolution. */
  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
  }

  /**
   * `removeView` only when this RenderHost created its own canvas
   * (`options.canvas` was omitted). A caller-provided canvas — the
   * embedding case the doc comment above names explicitly, e.g. a React
   * component's own `<canvas ref>` — belongs to that caller's DOM
   * lifecycle, not this one's: destroying the renderer must not reach out
   * and detach an element it didn't create. Found via a real symptom, not
   * inspection: a React 18 StrictMode dev-mode double-mount (mount →
   * cleanup → mount, the same canvas ref reused across both) had the
   * first, soon-discarded RenderHost's destroy() rip the shared canvas out
   * of the document, leaving the second, still-live instance's element
   * detached — reproduced with a real Playwright browser test
   * (packages/editor/test-browser/sceneCanvas.spec.ts) before this fix,
   * passing after it.
   */
  destroy(): void {
    this.app.destroy({ removeView: this.ownsCanvas }, { children: true, texture: true });
  }
}
