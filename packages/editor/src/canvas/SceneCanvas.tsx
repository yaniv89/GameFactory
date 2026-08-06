import { Camera, RenderHost, TilemapLayer } from "@forge/render-2d";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Sprite } from "pixi.js";
import { buildPaletteTextures, TILE_PALETTE } from "./tilePalette";
import "./SceneCanvas.css";

const GRID_WIDTH = 20;
const GRID_HEIGHT = 15;
const TILE_SIZE = 32;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
/** --surface-canvas from tokens.css, as a Pixi-friendly hex number (Pixi doesn't read CSS custom properties). */
const CANVAS_BACKGROUND = 0x232a26;

type CanvasStatus = "loading" | "ready" | "error";

interface RenderRig {
  readonly host: RenderHost;
  readonly camera: Camera;
  readonly layer: TilemapLayer<Sprite>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The real scene canvas: a live PixiJS surface via @forge/render-2d,
 * pan/zoom, and a tile-paint tool backed by a real TilemapLayer.
 *
 * State coverage (CLAUDE.md 5.4): this view only has an honest Loading
 * and Error — "the renderer is booting" and "it failed to boot" are the
 * two states that mechanically exist here. Empty/Permission-denied/
 * Offline have no real meaning yet: there's no scene document model
 * (Phase 3's undo store) and no backend (M5) for this view to be empty
 * of, denied by, or offline from. Forcing those in now would mean faking
 * a state with nothing real behind it — tracked as a gap for those later
 * phases, not silently skipped.
 */
export function SceneCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rigRef = useRef<RenderRig | null>(null);
  const paintingRef = useRef(false);
  const panningRef = useRef<{ lastX: number; lastY: number } | null>(null);

  const [status, setStatus] = useState<CanvasStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [selectedTileId, setSelectedTileId] = useState<number>(TILE_PALETTE[0]!.id);

  // Serializes boot/dispose across React 18 StrictMode's dev-only double-
  // invoke of this effect (mount -> cleanup -> mount again, reusing the
  // *same* canvas DOM node — refs aren't recreated for it). Found as a
  // real bug via a genuinely hanging Playwright test, not by inspection:
  // without this, the second invocation's RenderHost.create() started
  // concurrently with the first's — but a canvas can only have one
  // rendering context bound to it, so the two raced and neither reliably
  // finished. Each invocation now chains its boot (and, in cleanup, its
  // dispose) onto whatever the previous invocation was doing, so there is
  // never more than one RenderHost mid-init against this canvas at once.
  const lifecycleRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;

    const bootPromise = lifecycleRef.current.then(async () => {
      if (cancelled) return;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      try {
        const { width, height } = container.getBoundingClientRect();
        const host = await RenderHost.create({
          canvas,
          viewportWidth: Math.max(1, Math.floor(width)),
          viewportHeight: Math.max(1, Math.floor(height)),
          backgroundColor: CANVAS_BACKGROUND,
        });

        if (cancelled) {
          host.destroy();
          return;
        }

        const camera = new Camera({ viewportWidth: width, viewportHeight: height });
        camera.x = (GRID_WIDTH * TILE_SIZE) / 2;
        camera.y = (GRID_HEIGHT * TILE_SIZE) / 2;
        camera.applyTo(host.worldContainer);

        const paletteTextures = buildPaletteTextures(host.app.renderer, TILE_SIZE);
        const layer = new TilemapLayer<Sprite>({
          gridWidth: GRID_WIDTH,
          gridHeight: GRID_HEIGHT,
          tileSize: TILE_SIZE,
          tiles: new Array(GRID_WIDTH * GRID_HEIGHT).fill(0),
          container: host.worldContainer,
          createTileSprite: () => new Sprite(),
          resolveTileTexture: (tileId) => paletteTextures.get(tileId),
        });

        rigRef.current = { host, camera, layer };
        setStatus("ready");

        // Dev/test-only hook so a real-browser Playwright test can reach
        // the live renderer and assert on actual pixel output (the same
        // "extract pixels, check they're not blank" technique
        // packages/render-2d's own real-browser test uses) — never a
        // production concern, Vite dead-code-eliminates this whole block
        // when import.meta.env.DEV is statically false in a prod build.
        if (import.meta.env.DEV) {
          (window as unknown as { __forgeSceneCanvasDebug?: RenderRig }).__forgeSceneCanvasDebug = { host, camera, layer };
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[forge:editor] SceneCanvas failed to start the renderer", err);
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    });
    lifecycleRef.current = bootPromise;

    return () => {
      cancelled = true;
      lifecycleRef.current = bootPromise.then(() => {
        rigRef.current?.host.destroy();
        rigRef.current = null;
      });
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      const rig = rigRef.current;
      if (!rig || width <= 0 || height <= 0) return;
      rig.host.resize(width, height);
      rig.camera.resizeViewport(width, height);
      rig.camera.applyTo(rig.host.worldContainer);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const worldPointFromEvent = (e: { clientX: number; clientY: number }): { x: number; y: number } | undefined => {
    const rig = rigRef.current;
    const canvas = canvasRef.current;
    if (!rig || !canvas) return undefined;
    const rect = canvas.getBoundingClientRect();
    return rig.camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  };

  const paintAt = (worldX: number, worldY: number): void => {
    const rig = rigRef.current;
    if (!rig) return;
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    if (tileX < 0 || tileY < 0 || tileX >= rig.layer.gridWidth || tileY >= rig.layer.gridHeight) return;
    rig.layer.setTile(tileX, tileY, selectedTileId);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (status !== "ready") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 0) {
      paintingRef.current = true;
      const point = worldPointFromEvent(e);
      if (point) paintAt(point.x, point.y);
    } else if (e.button === 1 || e.button === 2) {
      panningRef.current = { lastX: e.clientX, lastY: e.clientY };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const rig = rigRef.current;
    if (!rig) return;

    if (paintingRef.current) {
      const point = worldPointFromEvent(e);
      if (point) paintAt(point.x, point.y);
      return;
    }

    const pan = panningRef.current;
    if (pan) {
      const dx = e.clientX - pan.lastX;
      const dy = e.clientY - pan.lastY;
      rig.camera.x -= dx / rig.camera.zoom;
      rig.camera.y -= dy / rig.camera.zoom;
      rig.camera.applyTo(rig.host.worldContainer);
      rig.layer.cull(rig.camera.visibleWorldBounds());
      panningRef.current = { lastX: e.clientX, lastY: e.clientY };
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    paintingRef.current = false;
    panningRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onWheel = (e: ReactWheelEvent<HTMLCanvasElement>): void => {
    const rig = rigRef.current;
    if (!rig) return;
    e.preventDefault();

    const point = worldPointFromEvent(e);
    if (!point) return;
    const zoomFactor = Math.exp(-e.deltaY * 0.001);
    rig.camera.zoom = clamp(rig.camera.zoom * zoomFactor, MIN_ZOOM, MAX_ZOOM);

    const pointAfter = worldPointFromEvent(e);
    if (pointAfter) {
      rig.camera.x += point.x - pointAfter.x;
      rig.camera.y += point.y - pointAfter.y;
    }
    rig.camera.applyTo(rig.host.worldContainer);
    rig.layer.cull(rig.camera.visibleWorldBounds());
  };

  return (
    <div className="fg-scene-canvas" ref={containerRef}>
      {status === "loading" && (
        <div className="fg-scene-canvas__overlay" role="status" aria-label="Starting the renderer">
          Starting the renderer…
        </div>
      )}
      {status === "error" && (
        <div className="fg-scene-canvas__overlay fg-scene-canvas__overlay--error" role="alert">
          <p>Couldn&rsquo;t start the renderer.</p>
          <p className="fg-scene-canvas__error-detail">{errorMessage}</p>
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="fg-scene-canvas__surface"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {status === "ready" && (
        <div className="fg-scene-canvas__palette" role="radiogroup" aria-label="Tile to paint">
          {TILE_PALETTE.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={selectedTileId === entry.id}
              className="fg-scene-canvas__swatch"
              style={{ ["--fg-swatch-color" as string]: `#${entry.color.toString(16).padStart(6, "0")}` }}
              onClick={() => setSelectedTileId(entry.id)}
              title={entry.label}
            >
              <span className="fg-scene-canvas__swatch-label">{entry.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
