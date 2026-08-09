import { Camera, RenderHost, TilemapLayer, createSpriteSyncSystem, createTransformSnapshotSystem, TransformSnapshotStore } from "@forge/render-2d";
import { Sprite } from "pixi.js";
import { buildEntityTextures } from "./entityMarkers.js";
import type { GameLogic } from "./gameLogic.js";
import { GRID_HEIGHT, GRID_WIDTH, TILE_SIZE } from "./gridConstants.js";
import type { PlayerScene } from "./playerProjectData.js";
import { buildPaletteTextures } from "./tilePalette.js";

/** --surface-canvas from tokens.css, as a Pixi-friendly hex number — kept visually consistent with the editor's own canvas, not because the player imports the token itself. */
const CANVAS_BACKGROUND = 0x232a26;

export interface RenderHandle {
  resize(width: number, height: number): void;
  dispose(): void;
}

function fitZoom(viewportWidth: number, viewportHeight: number): number {
  const worldWidth = GRID_WIDTH * TILE_SIZE;
  const worldHeight = GRID_HEIGHT * TILE_SIZE;
  if (worldWidth <= 0 || worldHeight <= 0) return 1;
  return Math.min(viewportWidth / worldWidth, viewportHeight / worldHeight);
}

/**
 * The rendering half of the standalone player, deferred from M6 Phase 5d
 * to land with the export CLI (Phase 5e) that actually bundles it — a
 * thin layer over `bootGameLogic`'s real `World`/`Scheduler`, the same
 * split `packages/editor/src/preview/gameWorld.ts`/`PreviewApp.tsx` keep,
 * except this one drives the player's own `RenderHost` via the app's
 * own ticker instead of React effects.
 *
 * No Art Pack asset resolution yet (`tilePalette.ts`'s own doc comment) —
 * a stated gap, tracked for a later phase.
 */
export async function bootRenderer(canvas: HTMLCanvasElement, scene: PlayerScene, game: GameLogic): Promise<RenderHandle> {
  const { clientWidth: width, clientHeight: height } = canvas;
  const host = await RenderHost.create({
    canvas,
    viewportWidth: Math.max(1, width),
    viewportHeight: Math.max(1, height),
    backgroundColor: CANVAS_BACKGROUND,
  });

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
    tiles: scene.tiles,
    container: host.worldContainer,
    createTileSprite: () => new Sprite(),
    resolveTileTexture: (tileId) => paletteTextures.get(tileId),
  });

  const snapshots = new TransformSnapshotStore();
  const entityTextures = buildEntityTextures(host.app.renderer, TILE_SIZE);
  game.scheduler.addSystem(createTransformSnapshotSystem(game.world, snapshots));
  game.scheduler.addSystem(
    createSpriteSyncSystem({
      world: game.world,
      container: host.worldContainer,
      snapshots,
      createSprite: () => new Sprite(),
      resolveTexture: (assetId) => entityTextures.get(assetId),
    }),
  );

  const onTick = (ticker: { deltaMS: number }): void => {
    game.tick(ticker.deltaMS);
    layer.cull(camera.visibleWorldBounds());
  };
  host.app.ticker.add(onTick);

  // Dev/test-only, same pattern as SceneCanvas's own __forgeSceneCanvasDebug
  // hook (packages/editor/src/canvas/SceneCanvas.tsx): lets a real-browser
  // Playwright test reach the live renderer and assert on actual pixel
  // output. Vite dead-code-eliminates this whole block when
  // import.meta.env.DEV is statically false — but note that an export's
  // own vite.config.ts still builds in production mode by default
  // (import.meta.env.DEV === false there too), so this never ships in an
  // actual exported game either way.
  if (import.meta.env.DEV) {
    (window as unknown as { __forgePlayerDebug?: { host: typeof host; camera: Camera; layer: typeof layer } }).__forgePlayerDebug = {
      host,
      camera,
      layer,
    };
  }

  return {
    resize(newWidth: number, newHeight: number): void {
      host.resize(newWidth, newHeight);
      camera.resizeViewport(newWidth, newHeight);
      camera.zoom = fitZoom(newWidth, newHeight);
      camera.applyTo(host.worldContainer);
      layer.cull(camera.visibleWorldBounds());
    },
    dispose(): void {
      host.app.ticker.remove(onTick);
      host.destroy();
    },
  };
}
