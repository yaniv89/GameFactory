import { Camera, RenderHost, TilemapLayer } from "@forge/render-2d";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Sprite, type Texture } from "pixi.js";
import { useCanvasPreviewStore } from "./canvasPreviewStore";
import { buildEntityTextures } from "./entityMarkers";
import { GRID_HEIGHT, GRID_WIDTH, TILE_SIZE } from "./gridConstants";
import { buildPaletteTextures, TILE_PALETTE } from "./tilePalette";
import { useProjectStore, type EntityPlacement } from "../store/projectStore";
import "./SceneCanvas.css";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
/** --surface-canvas from tokens.css, as a Pixi-friendly hex number (Pixi doesn't read CSS custom properties). */
const CANVAS_BACKGROUND = 0x232a26;
/** Distance (world units) a click must land within an entity's center to select it, in the "Select" tool. */
const ENTITY_PICK_RADIUS = TILE_SIZE * 0.5;

type CanvasStatus = "loading" | "ready" | "error";
type CanvasTool = "tiles" | "player" | "npc" | "select";

interface RenderRig {
  readonly host: RenderHost;
  readonly camera: Camera;
  readonly layer: TilemapLayer<Sprite>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snapshotTiles(layer: TilemapLayer<Sprite>): number[] {
  const tiles = new Array<number>(layer.gridWidth * layer.gridHeight);
  let index = 0;
  for (let y = 0; y < layer.gridHeight; y++) {
    for (let x = 0; x < layer.gridWidth; x++) {
      tiles[index++] = layer.getTile(x, y);
    }
  }
  return tiles;
}

/**
 * The real scene canvas: a live PixiJS surface via @forge/render-2d,
 * pan/zoom, a tile-paint tool backed by a real TilemapLayer, and (Phase
 * 7) entity placement — a player start and NPCs, real undoable
 * projectStore state scoped to `document.scenes[0]` (the editor doesn't
 * have a scene-tab/"active scene" concept yet, so this operates on the
 * first scene; a documented gap, not an oversight — see App-level notes).
 * Every paint or entity change publishes a snapshot to
 * canvasPreviewStore (Phase 6), which the Preview panel's sandboxed
 * iframe renders as an actual walkable game (Phase 7).
 *
 * Tile data itself is still not part of the project document or undo log
 * — that remains Phase 2's original, documented gap. Entities are, which
 * is an intentional asymmetry: entities are what Phase 7's exit criterion
 * needs to be real and undoable, tiles were not re-scoped to avoid
 * growing this phase further.
 *
 * State coverage (CLAUDE.md 5.4): this view only has an honest Loading
 * and Error — "the renderer is booting" and "it failed to boot" are the
 * two states that mechanically exist here. Empty/Permission-denied/
 * Offline have no real meaning yet: there's no backend (M5) for this view
 * to be denied by or offline from, and "no scene" is handled inline
 * (entity tools disable themselves) rather than as a whole-view empty
 * state, since tile painting still works with zero scenes. Forcing the
 * others in now would mean faking a state with nothing real behind it —
 * tracked as a gap for later phases, not silently skipped.
 */
export function SceneCanvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rigRef = useRef<RenderRig | null>(null);
  const paintingRef = useRef(false);
  const panningRef = useRef<{ lastX: number; lastY: number } | null>(null);
  // rAF-coalesced: a paint drag fires many setTile calls per frame, but the
  // Preview panel only needs the latest snapshot once per frame, not one
  // postMessage per pointermove.
  const previewSyncScheduledRef = useRef(false);

  const scheduleSyncPreview = (): void => {
    if (previewSyncScheduledRef.current) return;
    previewSyncScheduledRef.current = true;
    requestAnimationFrame(() => {
      previewSyncScheduledRef.current = false;
      const rig = rigRef.current;
      if (rig) useCanvasPreviewStore.getState().setTiles(snapshotTiles(rig.layer));
    });
  };

  const [status, setStatus] = useState<CanvasStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [selectedTileId, setSelectedTileId] = useState<number>(TILE_PALETTE[0]!.id);
  const [tool, setTool] = useState<CanvasTool>("tiles");

  const entityTexturesRef = useRef<Map<EntityPlacement["kind"], Texture> | null>(null);
  const entitySpritesRef = useRef<Map<string, Sprite>>(new Map());

  // No scene-tab/"active scene" concept yet (Phase 7's documented gap) —
  // entity tools operate on the first scene, since the exit criterion is
  // one walkable map, not scene switching.
  const activeScene = useProjectStore((state) => state.document.scenes[0]);
  const placePlayerStart = useProjectStore((state) => state.placePlayerStart);
  const placeNpc = useProjectStore((state) => state.placeNpc);
  const selectEntity = useProjectStore((state) => state.selectEntity);

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
        // Fit the whole grid in view on first boot so a first-time user can
        // see the entire map they're building without having to discover
        // pan/zoom first (5.9: a 100-scene project's first paint should
        // feel immediate and complete, and the same holds for a 3-scene
        // one — nothing here is progressive-loading-specific, it's just
        // "show the whole board"). Only applied once, at boot: later
        // resizes (ResizeObserver, below) deliberately preserve whatever
        // zoom the person has since chosen by hand.
        camera.zoom = clamp(Math.min(width / (GRID_WIDTH * TILE_SIZE), height / (GRID_HEIGHT * TILE_SIZE)), MIN_ZOOM, MAX_ZOOM);
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
        scheduleSyncPreview();

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

  // Keeps the Pixi entity markers in sync with the store's reactive
  // entity list. Rebuilds the whole set on every change rather than
  // diffing: entity counts here are small (a handful for a demo map), so
  // the simpler code is worth it over the added complexity of an
  // incremental diff.
  useEffect(() => {
    const rig = rigRef.current;
    if (status !== "ready" || !rig) return;
    if (!entityTexturesRef.current) {
      entityTexturesRef.current = buildEntityTextures(rig.host.app.renderer, TILE_SIZE);
    }
    const textures = entityTexturesRef.current;
    const sprites = entitySpritesRef.current;
    const entities = activeScene?.entities ?? [];
    const seenIds = new Set(entities.map((entity) => entity.id));

    for (const [id, sprite] of sprites) {
      if (seenIds.has(id)) continue;
      rig.host.worldContainer.removeChild(sprite);
      sprite.destroy();
      sprites.delete(id);
    }

    for (const entity of entities) {
      let sprite = sprites.get(entity.id);
      if (!sprite) {
        sprite = new Sprite(textures.get(entity.kind));
        sprite.anchor.set(0.5);
        rig.host.worldContainer.addChild(sprite);
        sprites.set(entity.id, sprite);
      }
      sprite.x = entity.tileX * TILE_SIZE + TILE_SIZE / 2;
      sprite.y = entity.tileY * TILE_SIZE + TILE_SIZE / 2;
    }
  }, [status, activeScene?.entities]);

  const worldPointFromEvent = (e: { clientX: number; clientY: number }): { x: number; y: number } | undefined => {
    const rig = rigRef.current;
    const canvas = canvasRef.current;
    if (!rig || !canvas) return undefined;
    const rect = canvas.getBoundingClientRect();
    return rig.camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  };

  const tileAt = (worldX: number, worldY: number): { tileX: number; tileY: number } | undefined => {
    const rig = rigRef.current;
    if (!rig) return undefined;
    const tileX = Math.floor(worldX / TILE_SIZE);
    const tileY = Math.floor(worldY / TILE_SIZE);
    if (tileX < 0 || tileY < 0 || tileX >= rig.layer.gridWidth || tileY >= rig.layer.gridHeight) return undefined;
    return { tileX, tileY };
  };

  const paintTileAt = (worldX: number, worldY: number): void => {
    const rig = rigRef.current;
    const tile = tileAt(worldX, worldY);
    if (!rig || !tile) return;
    rig.layer.setTile(tile.tileX, tile.tileY, selectedTileId);
    scheduleSyncPreview();
  };

  /** The left-click/tap dispatch across all four tools — see the `tool` state and its toolbar. */
  const handlePrimaryAction = (worldX: number, worldY: number): void => {
    if (tool === "tiles") {
      paintTileAt(worldX, worldY);
      return;
    }
    if (!activeScene) return; // entity tools need a scene to place into — the toolbar disables them too
    if (tool === "player") {
      const tile = tileAt(worldX, worldY);
      if (tile) placePlayerStart(activeScene.id, tile.tileX, tile.tileY);
      return;
    }
    if (tool === "npc") {
      const tile = tileAt(worldX, worldY);
      if (tile) placeNpc(activeScene.id, tile.tileX, tile.tileY);
      return;
    }
    // tool === "select"
    const hit = activeScene.entities.find((entity) => {
      const centerX = entity.tileX * TILE_SIZE + TILE_SIZE / 2;
      const centerY = entity.tileY * TILE_SIZE + TILE_SIZE / 2;
      return Math.hypot(worldX - centerX, worldY - centerY) <= ENTITY_PICK_RADIUS;
    });
    selectEntity(activeScene.id, hit?.id);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (status !== "ready") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (e.button === 0) {
      const point = worldPointFromEvent(e);
      if (point) handlePrimaryAction(point.x, point.y);
      // Only tile painting continues on drag — placing/selecting an
      // entity per pointermove pixel would place dozens of NPCs.
      if (tool === "tiles") paintingRef.current = true;
    } else if (e.button === 1 || e.button === 2) {
      panningRef.current = { lastX: e.clientX, lastY: e.clientY };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const rig = rigRef.current;
    if (!rig) return;

    if (paintingRef.current) {
      const point = worldPointFromEvent(e);
      if (point) paintTileAt(point.x, point.y);
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
        <div className="fg-scene-canvas__controls">
          <div className="fg-scene-canvas__toolbar" role="radiogroup" aria-label="Tool">
            {(
              [
                { tool: "tiles" as const, label: "Tiles", needsScene: false },
                { tool: "player" as const, label: "Player start", needsScene: true },
                { tool: "npc" as const, label: "NPC", needsScene: true },
                { tool: "select" as const, label: "Select", needsScene: true },
              ]
            ).map((entry) => (
              <button
                key={entry.tool}
                type="button"
                role="radio"
                aria-checked={tool === entry.tool}
                className="fg-scene-canvas__tool-button"
                disabled={entry.needsScene && !activeScene}
                title={entry.needsScene && !activeScene ? "Create a scene first" : undefined}
                onClick={() => setTool(entry.tool)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {tool === "tiles" && (
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
      )}
    </div>
  );
}
