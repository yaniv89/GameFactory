import { Camera, RenderHost, TilemapLayer } from "@forge/render-2d";
import { Sprite } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { buildPaletteTextures } from "../canvas/tilePalette";
import { GRID_HEIGHT, GRID_WIDTH, TILE_SIZE } from "../canvas/gridConstants";
import { isPreviewTilesMessage } from "./protocol";
import { TRUSTED_EDITOR_ORIGIN } from "./origins";
import "./PreviewApp.css";

type PreviewStatus = "loading" | "ready" | "error";

interface RenderRig {
  readonly host: RenderHost;
  readonly camera: Camera;
  readonly layer: TilemapLayer<Sprite>;
}

/** --surface-canvas from tokens.css, as a Pixi-friendly hex number. */
const CANVAS_BACKGROUND = 0x232a26;

function fitZoom(viewportWidth: number, viewportHeight: number): number {
  const worldWidth = GRID_WIDTH * TILE_SIZE;
  const worldHeight = GRID_HEIGHT * TILE_SIZE;
  if (worldWidth <= 0 || worldHeight <= 0) return 1;
  return Math.min(viewportWidth / worldWidth, viewportHeight / worldHeight);
}

/**
 * The preview iframe's own root — a read-only render of whatever the
 * editor's SceneCanvas last painted, received over the postMessage bridge
 * (protocol.ts), not shared state or a direct import: this document is a
 * genuinely separate page (play.forge.dev in production, docs/SPEC.md
 * 10.6), reachable only through that channel.
 *
 * The same StrictMode-safe boot/dispose lifecycle as SceneCanvas
 * (packages/editor/src/canvas/SceneCanvas.tsx's doc comment explains the
 * race it guards against) — duplicated rather than extracted into a
 * shared hook, since the two consumers' post-boot setup differs enough
 * (paint tool vs. postMessage listener) that factoring it out now would
 * be speculative; revisit if a third consumer appears.
 */
export function PreviewApp() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rigRef = useRef<RenderRig | null>(null);
  const lifecycleRef = useRef<Promise<void>>(Promise.resolve());

  const [status, setStatus] = useState<PreviewStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

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
        camera.zoom = fitZoom(width, height);
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
        window.parent.postMessage({ type: "forge:preview:ready" }, "*");

        if (import.meta.env.DEV) {
          (window as unknown as { __forgePreviewDebug?: RenderRig }).__forgePreviewDebug = { host, camera, layer };
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error("[forge:preview] failed to start the renderer", err);
        setErrorMessage(message);
        setStatus("error");
        window.parent.postMessage({ type: "forge:preview:error", message }, "*");
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
      rig.camera.zoom = fitZoom(width, height);
      rig.camera.applyTo(rig.host.worldContainer);
      rig.layer.cull(rig.camera.visibleWorldBounds());
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      // Only the editor that framed this page may drive it — never trust
      // postMessage sender identity by anything other than origin
      // (CLAUDE.md 1.1.4's "never trust a client-supplied identifier"
      // applies just as much to a cross-window message as to a request).
      if (event.origin !== TRUSTED_EDITOR_ORIGIN) return;
      if (!isPreviewTilesMessage(event.data)) {
        // Same-origin postMessage traffic isn't necessarily ours — Vite's
        // own dev client posts unrelated messages when embedded in a
        // frame. Only warn about things that look like a malformed
        // attempt at our protocol, not every unrelated message.
        const looksLikeOurs =
          typeof event.data === "object" &&
          event.data !== null &&
          typeof (event.data as { type?: unknown }).type === "string" &&
          (event.data as { type: string }).type.startsWith("forge:preview:");
        if (looksLikeOurs) console.warn("[forge:preview] ignored a malformed forge:preview:tiles message");
        return;
      }
      const rig = rigRef.current;
      if (!rig) return;
      const { tiles } = event.data;
      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          const tileId = tiles[y * GRID_WIDTH + x]!;
          if (rig.layer.getTile(x, y) !== tileId) rig.layer.setTile(x, y, tileId);
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="fg-preview-app" ref={containerRef}>
      {status === "loading" && (
        <div className="fg-preview-app__overlay" role="status" aria-label="Starting the preview">
          Starting the preview…
        </div>
      )}
      {status === "error" && (
        <div className="fg-preview-app__overlay fg-preview-app__overlay--error" role="alert">
          <p>Couldn&rsquo;t start the preview.</p>
          <p className="fg-preview-app__error-detail">{errorMessage}</p>
        </div>
      )}
      <canvas ref={canvasRef} className="fg-preview-app__surface" />
    </div>
  );
}
