import { Camera, RenderHost, TilemapLayer } from "@forge/render-2d";
import { Container, Rectangle, Sprite } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { GRID_HEIGHT, GRID_WIDTH, TILE_SIZE } from "./gridConstants";
import { buildPackAwarePaletteTextures, type ActivePackContext } from "./packTiles";
import "./PackSwapPreview.css";

const PREVIEW_WIDTH = 420;
const PREVIEW_HEIGHT = 315;
/** Same hex as SceneCanvas's own CANVAS_BACKGROUND — --surface-canvas from tokens.css, Pixi-friendly form. */
const CANVAS_BACKGROUND = 0x232a26;

/**
 * Renders one side's tile grid against one pack's textures and draws
 * the result onto `visibleCanvas` via a plain 2D `drawImage` — not a
 * second live WebGL context of its own. Reuses `renderer` (a single
 * shared, offscreen `RenderHost` the caller owns) for both sides in
 * turn, tearing down each side's own display tree before the next.
 *
 * Found the hard way, not assumed: an earlier version gave each side
 * (source, target) its own `RenderHost` — a third concurrent WebGL
 * context alongside the main canvas's — and a real-browser Playwright
 * test crashed the whole page on it (`Target page, context or browser
 * has been closed`, reproduced directly with a standalone Playwright
 * script before this rewrite, not merely suspected). One shared
 * renderer, used sequentially, keeps this at two contexts total (the
 * main canvas's plus this preview's own), which doesn't crash.
 */
async function renderSideToCanvas(
  renderer: RenderHost,
  visibleCanvas: HTMLCanvasElement,
  packContext: ActivePackContext | undefined,
  terrainRemap: Readonly<Record<string, string>>,
  tiles: readonly number[],
): Promise<void> {
  // Two containers, not one: `extract.canvas`'s `target` is rendered as
  // its own root — its *own* position/scale are not applied, only its
  // children's transforms relative to it (found the hard way: a sanity
  // sprite parented directly under a camera-transformed container came
  // back from extraction at its native, unscaled size and position,
  // proving the container's own transform was silently dropped). Camera
  // goes on the inner `sceneContainer`; `root` — always identity — is
  // what gets passed to `extract`, so `sceneContainer`'s transform is
  // for once a *child* transform relative to a real parent, and composes
  // normally.
  const root = new Container();
  const sceneContainer = new Container();
  root.addChild(sceneContainer);
  renderer.app.stage.addChild(root);

  const camera = new Camera({ viewportWidth: PREVIEW_WIDTH, viewportHeight: PREVIEW_HEIGHT });
  camera.x = (GRID_WIDTH * TILE_SIZE) / 2;
  camera.y = (GRID_HEIGHT * TILE_SIZE) / 2;
  camera.zoom = Math.min(PREVIEW_WIDTH / (GRID_WIDTH * TILE_SIZE), PREVIEW_HEIGHT / (GRID_HEIGHT * TILE_SIZE));
  camera.applyTo(sceneContainer);

  try {
    const paletteTextures = await buildPackAwarePaletteTextures(renderer.app.renderer, TILE_SIZE, packContext, terrainRemap);

    new TilemapLayer<Sprite>({
      gridWidth: GRID_WIDTH,
      gridHeight: GRID_HEIGHT,
      tileSize: TILE_SIZE,
      tiles,
      container: sceneContainer,
      createTileSprite: () => new Sprite(),
      resolveTileTexture: (tileId) => paletteTextures.get(tileId),
    });

    // `extract.canvas` renders `target` to an offscreen texture and reads
    // it back itself — a separate pass from whatever's already on the
    // main framebuffer, so no explicit `renderer.render(...)` is needed
    // first. `frame` is required, not optional: left unset, extract sizes
    // its output to the target's own *content bounds* (packages/render-2d's
    // TilemapLayer only creates a sprite per non-empty cell, so a mostly-
    // empty grid's content bounds can be a single tile, not the full
    // viewport) — the exact pitfall sceneCanvas.spec.ts's own comment
    // already flags for `extract.pixels()`.
    const extracted = renderer.app.renderer.extract.canvas({
      target: root,
      frame: new Rectangle(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT),
    }) as HTMLCanvasElement;
    const ctx = visibleCanvas.getContext("2d");
    ctx?.clearRect(0, 0, PREVIEW_WIDTH, PREVIEW_HEIGHT);
    ctx?.drawImage(extracted, 0, 0);
  } finally {
    root.destroy({ children: true });
  }
}

interface PackSwapPreviewDebug {
  readonly sourceCanvas: HTMLCanvasElement;
  readonly targetCanvas: HTMLCanvasElement;
}

export interface PackSwapPreviewProps {
  /** `undefined` renders the flat-color fallback — the same "no pack active" world the main canvas shows. */
  sourceContext: ActivePackContext | undefined;
  targetContext: ActivePackContext | undefined;
  terrainRemap: Readonly<Record<string, string>>;
  tiles: readonly number[];
  sourceLabel: string;
  targetLabel: string;
}

/**
 * docs/SPEC.md Section 5.8's "live side-by-side preview with a
 * draggable comparison divider" — two real renders of the project's
 * current tile grid, one per pack, overlapped and wiped between via a
 * native `<input type="range">` (keyboard, touch, and mouse dragging
 * for free — CLAUDE.md 5.6's accessibility floor, not a hand-rolled
 * pointer-drag reimplementation of what a range input already does).
 * The range input itself is the actual hit target (full-size,
 * transparent) so dragging directly on the image works; the visible
 * vertical line + handle are a decorative overlay kept in sync with its
 * value, not a second interactive control.
 *
 * `tiles` is a snapshot taken once when the comparison opens, not a
 * live subscription — the dialog is modal (`Dialog`'s own focus trap),
 * so the real canvas underneath can't be edited while this is open,
 * making "live" here mean "the real pack textures, rendered for real,"
 * not "keeps re-rendering as someone paints elsewhere."
 */
export function PackSwapPreview({ sourceContext, targetContext, terrainRemap, tiles, sourceLabel, targetLabel }: PackSwapPreviewProps) {
  const [dividerPercent, setDividerPercent] = useState(50);
  const [focused, setFocused] = useState(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null);
  const targetCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");

    void (async () => {
      const sourceCanvas = sourceCanvasRef.current;
      const targetCanvas = targetCanvasRef.current;
      if (!sourceCanvas || !targetCanvas) return;

      // Offscreen: created and rendered into, but never inserted into the
      // document — RenderHost's own canvas, not one of the two visible
      // panes. Its only job is to be the one shared WebGL context both
      // sides extract their pixels from in turn.
      const offscreenCanvas = document.createElement("canvas");
      let renderer: RenderHost | undefined;
      try {
        renderer = await RenderHost.create({
          canvas: offscreenCanvas,
          viewportWidth: PREVIEW_WIDTH,
          viewportHeight: PREVIEW_HEIGHT,
          backgroundColor: CANVAS_BACKGROUND,
        });
        if (cancelled) return;

        await renderSideToCanvas(renderer, sourceCanvas, sourceContext, terrainRemap, tiles);
        if (cancelled) return;
        await renderSideToCanvas(renderer, targetCanvas, targetContext, terrainRemap, tiles);
        if (cancelled) return;

        setStatus("ready");

        // Dev/test-only, mirroring SceneCanvas's own
        // `__forgeSceneCanvasDebug` hook: lets a real-browser Playwright
        // test read the two already-drawn preview canvases directly —
        // no live renderer to force-render, since both are finished, plain
        // 2D drawImage output by this point. Vite dead-code-eliminates
        // this whole block in a production build.
        if (import.meta.env.DEV) {
          (window as unknown as { __forgePackSwapPreviewDebug?: PackSwapPreviewDebug }).__forgePackSwapPreviewDebug = {
            sourceCanvas,
            targetCanvas,
          };
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[forge:editor] pack-swap preview failed to render", err);
        setStatus("error");
      } finally {
        renderer?.destroy();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sourceContext, targetContext, terrainRemap, tiles]);

  return (
    <div className="fg-pack-swap-preview">
      <div className="fg-pack-swap-preview__stage" style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}>
        <div className="fg-pack-swap-preview__layer">
          <div className="fg-pack-swap-preview__pane">
            <canvas ref={sourceCanvasRef} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} className="fg-pack-swap-preview__canvas" />
          </div>
        </div>
        <div
          className="fg-pack-swap-preview__layer fg-pack-swap-preview__layer--clipped"
          style={{ clipPath: `inset(0 ${100 - dividerPercent}% 0 0)` }}
        >
          <div className="fg-pack-swap-preview__pane">
            <canvas ref={targetCanvasRef} width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} className="fg-pack-swap-preview__canvas" />
          </div>
        </div>
        {status === "loading" && (
          <div className="fg-pack-swap-preview__pane-overlay" role="status">
            Rendering…
          </div>
        )}
        {status === "error" && (
          <div className="fg-pack-swap-preview__pane-overlay fg-pack-swap-preview__pane-overlay--error" role="alert">
            Couldn&rsquo;t render this preview.
          </div>
        )}
        <div
          className={`fg-pack-swap-preview__divider${focused ? " fg-pack-swap-preview__divider--focused" : ""}`}
          style={{ left: `${dividerPercent}%` }}
          aria-hidden="true"
        >
          <span className="fg-pack-swap-preview__handle" />
        </div>
        <input
          type="range"
          className="fg-pack-swap-preview__range"
          min={0}
          max={100}
          value={dividerPercent}
          onChange={(e) => setDividerPercent(Number(e.target.value))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          aria-label="Comparison divider"
          aria-valuetext={`${dividerPercent}% ${targetLabel}, ${100 - dividerPercent}% ${sourceLabel}`}
        />
      </div>
      <div className="fg-pack-swap-preview__labels">
        <span>{sourceLabel}</span>
        <span>{targetLabel}</span>
      </div>
    </div>
  );
}
