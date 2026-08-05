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

  private constructor(app: Application, worldContainer: Container) {
    this.app = app;
    this.worldContainer = worldContainer;
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

    const worldContainer = new Container({ label: "world" });
    app.stage.addChild(worldContainer);

    return new RenderHost(app, worldContainer);
  }

  /** Letterbox resize: called on window/container resize, per project settings' `viewport.scaleMode`. Actual letterbox math (scale-to-fit + centering) belongs to the editor/runtime host embedding this, which knows the outer element's size — this just retargets the renderer's own resolution. */
  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
  }

  destroy(): void {
    this.app.destroy(true, { children: true, texture: true });
  }
}
