import { createCharacterAnimationSystem, type SceneChangedEvent } from "@forge/core";
import {
  Camera,
  RenderHost,
  TilemapLayer,
  createSpriteSyncSystem,
  createTextSyncSystem,
  createTransformSnapshotSystem,
  TransformSnapshotStore,
} from "@forge/render-2d";
import { Sprite, Text } from "pixi.js";
import { buildEntityTextures } from "./entityMarkers.js";
import type { GameLogic } from "./gameLogic.js";
import { ENEMY_ASSET_ID, NPC_ASSET_ID, PLAYER_ASSET_ID } from "./gameWorld.js";
import { GRID_HEIGHT, GRID_WIDTH, TILE_SIZE } from "./gridConstants.js";
import { buildPlayerCharacterTextures, buildPlayerPaletteTextures, type PlayerCharacterFrameSet } from "./packArt.js";
import type { PlayerProjectData } from "./playerProjectData.js";

/** `Sprite.assetId` -> the active pack's own `characters.sheets` role id — matches `packages/editor/src/preview/PreviewApp.tsx`'s own `ASSET_ID_TO_CHARACTER_ROLE` exactly. `entityTextures`'s own flat marker (a triangle/circle/rounded-square, per role) stays the fallback for any role the active pack doesn't declare a sheet for. */
const ASSET_ID_TO_CHARACTER_ROLE: Readonly<Record<number, string>> = {
  [PLAYER_ASSET_ID]: "hero",
  [NPC_ASSET_ID]: "villager",
  [ENEMY_ASSET_ID]: "goblin",
};

/** Matches PreviewApp.tsx's own WALK_FRAME_COUNT/WALK_FPS exactly — every character sheet this repo's own generated art and `createCharacterAnimationSystem` agree on. */
const WALK_FRAME_COUNT = 4;
const WALK_FPS = 8;

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
 * K1 Phase 2b wires real Art Pack asset resolution here (`packArt.ts`) —
 * ground tiles and hero/villager/goblin character sheets, embedded at
 * export time (`resolvePackData`, packages/cli/src/commands/export.ts).
 * `tilePalette.ts`'s own flat colors and `entityMarkers.ts`'s own flat
 * shapes are what actually render when there's no active pack, or the
 * active pack doesn't declare a given role — never a missing/broken sprite.
 *
 * Takes the whole `PlayerProjectData`, not just the start scene, so a
 * later `"scene:changed"` can look up whichever scene comes next — see
 * the `game.events.on("scene:changed", ...)` subscription below, the
 * tilemap half of `gameLogic.ts`'s own scene-swap reaction (the entity
 * half needs no equivalent code here at all; see that subscription's own
 * comment for why).
 */
export async function bootRenderer(canvas: HTMLCanvasElement, projectData: PlayerProjectData, game: GameLogic): Promise<RenderHandle> {
  const scene = projectData.scenes.find((candidate) => candidate.id === projectData.startSceneId);
  if (!scene) throw new Error(`bootRenderer: projectData has no scene "${projectData.startSceneId}"`);

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

  // K1 Phase 2b: real Art Pack ground textures when the export embedded
  // one, the same flat-color fallback as before when it didn't
  // (`buildPlayerPaletteTextures`'s own doc comment).
  const paletteTextures = await buildPlayerPaletteTextures(host.app.renderer, TILE_SIZE, projectData.pack);
  const layer = new TilemapLayer<Sprite>({
    gridWidth: GRID_WIDTH,
    gridHeight: GRID_HEIGHT,
    tileSize: TILE_SIZE,
    tiles: scene.tiles,
    container: host.worldContainer,
    createTileSprite: () => new Sprite(),
    resolveTileTexture: (tileId) => paletteTextures.get(tileId),
  });

  // The tilemap is the one piece of a scene's content this renderer has to
  // swap explicitly on "scene:changed" — entity sprites need no equivalent
  // handling here at all, since createSpriteSyncSystem below is already a
  // generic [Transform, Sprite] query: gameLogic.ts destroying the old
  // scene's NPC entities and creating the new scene's is all that system
  // needs to see to remove and add their sprites on its own.
  const unsubscribeSceneChanged = game.events.on("scene:changed", (payload) => {
    const { to } = payload as SceneChangedEvent;
    const nextScene = projectData.scenes.find((candidate) => candidate.id === to);
    if (!nextScene) return; // gameLogic.ts's own handler already throws loudly on this; nothing more for the renderer to do.
    layer.setTiles(nextScene.tiles);
  });

  const snapshots = new TransformSnapshotStore();
  const entityTextures = buildEntityTextures(host.app.renderer, TILE_SIZE);
  // K1 Phase 2b: real, animated hero/villager art when the export
  // embedded a pack that declares character sheets; `entityTextures`'s
  // own flat circle stays the fallback for any role the pack doesn't
  // cover, exactly as before this existed.
  const characterTextures = await buildPlayerCharacterTextures(projectData.pack);
  game.scheduler.addSystem(createTransformSnapshotSystem(game.world, snapshots));
  game.scheduler.addSystem(createCharacterAnimationSystem({ world: game.world, frameCount: WALK_FRAME_COUNT, fps: WALK_FPS }));
  game.scheduler.addSystem(
    createSpriteSyncSystem({
      world: game.world,
      container: host.worldContainer,
      snapshots,
      createSprite: () => new Sprite(),
      resolveTexture: (assetId: number, frame: number) => {
        const role = ASSET_ID_TO_CHARACTER_ROLE[assetId];
        const frameSet: PlayerCharacterFrameSet | undefined = role ? characterTextures.get(role) : undefined;
        return frameSet?.frames[frame] ?? entityTextures.get(assetId);
      },
    }),
  );
  // H1d's floating damage numbers — matches PreviewApp.tsx's own text style exactly.
  game.scheduler.addSystem(
    createTextSyncSystem<Text>({
      world: game.world,
      container: host.worldContainer,
      createText: () => {
        const text = new Text({ text: "", style: { fill: 0xff5050, fontSize: 14, fontWeight: "bold" } });
        text.anchor.set(0.5, 1);
        return text;
      },
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
      unsubscribeSceneChanged();
      host.app.ticker.remove(onTick);
      host.destroy();
    },
  };
}
