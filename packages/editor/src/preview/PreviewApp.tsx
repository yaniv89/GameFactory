import { createCharacterAnimationSystem, registerCoreComponents, Scheduler, TransformSchema, World, type EntityId } from "@forge/core";
import { dialogueModule } from "@forge/dialogue";
import { buildDialogueTreesFromEntities } from "@forge/project-export";
import {
  Camera,
  RenderHost,
  TilemapLayer,
  createSpriteSyncSystem,
  createTransformSnapshotSystem,
  TransformSnapshotStore,
} from "@forge/render-2d";
import { Sprite, type Texture } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { buildPackAwareCharacterTextures, type CharacterFrameSet } from "../canvas/characterTextures";
import { buildEntityTextures } from "../canvas/entityMarkers";
import { GRID_HEIGHT, GRID_WIDTH, TILE_SIZE } from "../canvas/gridConstants";
import { loadActivePackContext } from "../canvas/packTiles";
import { WALL_TILE_ID, buildPaletteTextures } from "../canvas/tilePalette";
import type { EntityPlacement } from "../store/projectStore";
import { fitZoom as fitZoomOf, followCamera as followCameraOf, followZoom as followZoomOf } from "./cameraFollow";
import { createModuleRuntime } from "./directModuleHost";
import { INTERACT_RANGE, NPC_ASSET_ID, PLAYER_ASSET_ID, createPlayerMovementSystem, spawnNpcMarker, spawnPlayer } from "./gameWorld";
import { TRUSTED_EDITOR_ORIGIN } from "./origins";
import { isPreviewSceneMessage } from "./protocol";
import { RichDialogueText } from "./RichDialogueText";
import "./PreviewApp.css";

/** `Sprite.assetId` -> the active pack's own `characters.sheets` role id — the one place this preview maps "which prefab" to "which pack-declared art role." */
const ASSET_ID_TO_CHARACTER_ROLE: Readonly<Record<number, string>> = {
  [PLAYER_ASSET_ID]: "hero",
  [NPC_ASSET_ID]: "villager",
};

/** Every character sheet this repo's own generated art (`gensprite_h1.py`) and `createCharacterAnimationSystem` agree on: a 4-direction, 4-frame walk cycle at 8fps. A pack declaring a different `walk` animation shape is a known limitation, not silently handled — see `characterTextures.ts`'s own doc comment on what a pack can and can't override yet. */
const WALK_FRAME_COUNT = 4;
const WALK_FPS = 8;

type PreviewStatus = "loading" | "ready" | "error";

interface RenderRig {
  readonly host: RenderHost;
  readonly camera: Camera;
  readonly layer: TilemapLayer<Sprite>;
}

/** The always-on ECS world: player + NPC render/movement entities. Created once at boot and never recreated — recreating it would reset the player's position on every tile paint or entity edit. */
interface GameWorld {
  readonly world: World;
  readonly scheduler: Scheduler;
  playerEntity: EntityId | undefined;
  readonly npcEntitiesByPlacementId: Map<string, EntityId>;
}

/** The dialogue module's own world, rebuilt whenever the NPC/dialogue set changes (see the doc comment on the scene-message effect below for why this is a *separate*, disposable world from GameWorld). */
interface DialogueRuntime {
  readonly runtime: ReturnType<typeof createModuleRuntime>;
  readonly dialogueEntityByPlacementId: Map<string, EntityId>;
}

interface DialogueBubble {
  readonly speaker: string;
  readonly text: string;
}

/** --surface-canvas from tokens.css, as a Pixi-friendly hex number. */
const CANVAS_BACKGROUND = 0x232a26;
const DIALOGUE_BUBBLE_MS = 3500;

const WORLD_WIDTH = GRID_WIDTH * TILE_SIZE;
const WORLD_HEIGHT = GRID_HEIGHT * TILE_SIZE;

function fitZoom(viewportWidth: number, viewportHeight: number): number {
  return fitZoomOf(viewportWidth, viewportHeight, WORLD_WIDTH, WORLD_HEIGHT);
}

function followZoom(viewportWidth: number, viewportHeight: number): number {
  return followZoomOf(viewportWidth, viewportHeight, WORLD_WIDTH, WORLD_HEIGHT);
}

function followCamera(camera: Camera, targetX: number, targetY: number): void {
  followCameraOf(camera, targetX, targetY, WORLD_WIDTH, WORLD_HEIGHT);
}

function tileCenterWorld(tileX: number, tileY: number): { x: number; y: number } {
  return { x: tileX * TILE_SIZE + TILE_SIZE / 2, y: tileY * TILE_SIZE + TILE_SIZE / 2 };
}

/**
 * The preview iframe's own root — a genuinely running game (Phase 7), not
 * just a static render of whatever the editor's SceneCanvas last
 * painted: a real `@forge/core` World drives a walkable player (WASD/
 * arrows), tile-grid collision against Wall tiles, and NPCs that show a
 * real one-line `@forge/dialogue` conversation on interact ("E"). All
 * driven by scene data received over the postMessage bridge (protocol.ts)
 * — this document is a genuinely separate page (play.forge.dev in
 * production, docs/SPEC.md 10.6), reachable only through that channel.
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
  const gameWorldRef = useRef<GameWorld | null>(null);
  const dialogueRef = useRef<DialogueRuntime | null>(null);
  /** Populated asynchronously once a `forge:preview:scene` message names an `activePack` — read every tick by the sprite-sync `resolveTexture` closure below, which is wired once at boot before any pack has necessarily loaded. Empty map (not undefined) so a lookup miss and "still loading" look identical: fall back to the placeholder marker either way. */
  const characterTexturesRef = useRef<Map<string, CharacterFrameSet>>(new Map());
  /** The `activePack` name this preview has already loaded (or attempted to) — guards against re-fetching the same pack's manifest on every scene message (tile paints fire these constantly) and against a stale, slower-to-resolve fetch clobbering a newer one. */
  const loadedPackNameRef = useRef<string | undefined>(undefined);
  /** The panel's current pixel size — read by the per-tick camera-follow logic (H1b) so it doesn't need to re-measure the DOM every frame; kept current by the boot effect and the resize observer below. */
  const viewportSizeRef = useRef({ width: 1, height: 1 });
  const keysHeldRef = useRef<Set<string>>(new Set());
  const bubbleTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lifecycleRef = useRef<Promise<void>>(Promise.resolve());
  const tickerCallbackRef = useRef<((ticker: { deltaMS: number }) => void) | null>(null);

  const [status, setStatus] = useState<PreviewStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [bubble, setBubble] = useState<DialogueBubble | null>(null);

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

        // Fit-the-whole-map, centered — same as before H1b, and kept until
        // a real player entity exists to follow (below). Zooming in before
        // there's anyone to center on would just be an arbitrary crop of
        // an otherwise-empty map, not a camera "following" anything.
        viewportSizeRef.current = { width, height };
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

        const isWalkable = (worldX: number, worldY: number): boolean => {
          const tileX = Math.floor(worldX / TILE_SIZE);
          const tileY = Math.floor(worldY / TILE_SIZE);
          if (tileX < 0 || tileY < 0 || tileX >= GRID_WIDTH || tileY >= GRID_HEIGHT) return false;
          return layer.getTile(tileX, tileY) !== WALL_TILE_ID;
        };

        const world = new World();
        registerCoreComponents(world);
        const scheduler = new Scheduler(world);
        const snapshots = new TransformSnapshotStore();
        const entityTextures = buildEntityTextures(host.app.renderer, TILE_SIZE);
        scheduler.addSystem(createTransformSnapshotSystem(world, snapshots));
        scheduler.addSystem(createPlayerMovementSystem(world, isWalkable, keysHeldRef.current));
        scheduler.addSystem(createCharacterAnimationSystem({ world, frameCount: WALK_FRAME_COUNT, fps: WALK_FPS }));
        scheduler.addSystem(
          createSpriteSyncSystem({
            world,
            container: host.worldContainer,
            snapshots,
            createSprite: () => new Sprite(),
            resolveTexture: (assetId: number, frame: number): Texture | undefined => {
              const role = ASSET_ID_TO_CHARACTER_ROLE[assetId];
              const frameSet = role ? characterTexturesRef.current.get(role) : undefined;
              const animatedFrame = frameSet?.frames[frame];
              if (animatedFrame) return animatedFrame;
              return entityTextures.get(assetId === PLAYER_ASSET_ID ? "player-start" : "npc");
            },
          }),
        );
        gameWorldRef.current = { world, scheduler, playerEntity: undefined, npcEntitiesByPlacementId: new Map() };

        const onTick = (ticker: { deltaMS: number }) => {
          scheduler.tick(ticker.deltaMS);
          const playerEntity = gameWorldRef.current?.playerEntity;
          const playerTransform = playerEntity !== undefined ? world.get<typeof TransformSchema>(playerEntity, "Transform") : undefined;
          if (playerTransform) {
            const { width: vw, height: vh } = viewportSizeRef.current;
            camera.zoom = followZoom(vw, vh);
            followCamera(camera, playerTransform.x, playerTransform.y);
            camera.applyTo(host.worldContainer);
            layer.cull(camera.visibleWorldBounds(TILE_SIZE));
          }
        };
        tickerCallbackRef.current = onTick;
        host.app.ticker.add(onTick);

        setStatus("ready");
        window.parent.postMessage({ type: "forge:preview:ready" }, TRUSTED_EDITOR_ORIGIN);

        if (import.meta.env.DEV) {
          (window as unknown as { __forgePreviewDebug?: RenderRig & { gameWorld: GameWorld | null } }).__forgePreviewDebug = {
            host,
            camera,
            layer,
            gameWorld: gameWorldRef.current,
          };
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error("[forge:preview] failed to start the renderer", err);
        setErrorMessage(message);
        setStatus("error");
        window.parent.postMessage({ type: "forge:preview:error", message }, TRUSTED_EDITOR_ORIGIN);
      }
    });
    lifecycleRef.current = bootPromise;

    return () => {
      cancelled = true;
      lifecycleRef.current = bootPromise.then(() => {
        if (tickerCallbackRef.current) rigRef.current?.host.app.ticker.remove(tickerCallbackRef.current);
        rigRef.current?.host.destroy();
        rigRef.current = null;
        gameWorldRef.current = null;
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
      viewportSizeRef.current = { width, height };
      rig.host.resize(width, height);
      rig.camera.resizeViewport(width, height);
      // Before a player exists, keep fitting the whole map (same as boot);
      // once one does, the per-tick follow logic (onTick, above) already
      // recomputes zoom and re-clamps every frame regardless of what's set
      // here — this only needs to avoid clobbering that with a stale
      // fit-zoom on a resize that lands between two follow ticks.
      const hasPlayer = gameWorldRef.current?.playerEntity !== undefined;
      rig.camera.zoom = hasPlayer ? followZoom(width, height) : fitZoom(width, height);
      if (!hasPlayer) {
        rig.camera.x = (GRID_WIDTH * TILE_SIZE) / 2;
        rig.camera.y = (GRID_HEIGHT * TILE_SIZE) / 2;
      }
      rig.camera.applyTo(rig.host.worldContainer);
      rig.layer.cull(rig.camera.visibleWorldBounds(TILE_SIZE));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // The scene-data bridge. Tiles are applied straight to the live
  // TilemapLayer, same as before Phase 7. Entities are reconciled against
  // the *persistent* GameWorld (spawn once, never reset an existing
  // player's position on a later message) but the dialogue module is
  // rebuilt fresh every time: config.trees is only ever read once, at
  // dialogueModule.setup(), so there is no way to hand it updated content
  // without a fresh setup() call. Rebuilding costs nothing but an
  // in-progress conversation's DialogueState — an acceptable, documented
  // trade against never being able to see an edited NPC line at all.
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.origin !== TRUSTED_EDITOR_ORIGIN) return;
      if (!isPreviewSceneMessage(event.data)) {
        const looksLikeOurs =
          typeof event.data === "object" &&
          event.data !== null &&
          typeof (event.data as { type?: unknown }).type === "string" &&
          (event.data as { type: string }).type.startsWith("forge:preview:");
        if (looksLikeOurs) console.warn("[forge:preview] ignored a malformed forge:preview:scene message");
        return;
      }
      const rig = rigRef.current;
      const gameWorld = gameWorldRef.current;
      if (!rig || !gameWorld) return;
      const { tiles, entities, activePack } = event.data;

      // Fire-and-forget, guarded against duplicate/stale loads: most
      // `forge:preview:scene` messages (every tile paint) repeat the same
      // `activePack`, and this only needs to (re)fetch the manifest and
      // slice character textures when it actually changes. Sprite
      // rendering self-heals once `characterTexturesRef` updates — the
      // sprite-sync system above calls `resolveTexture` unconditionally
      // every tick, so no explicit re-render/refresh is needed here.
      if (activePack !== loadedPackNameRef.current) {
        loadedPackNameRef.current = activePack;
        characterTexturesRef.current = new Map(); // clear immediately: don't keep showing the outgoing pack's art while the new one loads.
        void loadActivePackContext(activePack)
          .then((context) => buildPackAwareCharacterTextures(context))
          .then((textures) => {
            if (loadedPackNameRef.current === activePack) characterTexturesRef.current = textures;
          })
          .catch((err) => {
            console.warn("[forge:preview] failed to load character art for the active pack — falling back to placeholder markers.", err);
          });
      }

      for (let y = 0; y < GRID_HEIGHT; y++) {
        for (let x = 0; x < GRID_WIDTH; x++) {
          const tileId = tiles[y * GRID_WIDTH + x]!;
          if (rig.layer.getTile(x, y) !== tileId) rig.layer.setTile(x, y, tileId);
        }
      }

      reconcileEntities(gameWorld, entities);
      dialogueRef.current = rebuildDialogueRuntime(entities, (payload) => {
        clearTimeout(bubbleTimeoutRef.current);
        setBubble({ speaker: payload.speaker, text: payload.text });
        bubbleTimeoutRef.current = setTimeout(() => setBubble(null), DIALOGUE_BUBBLE_MS);
      });
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(bubbleTimeoutRef.current);
    };
  }, []);

  // "E" to interact with the nearest NPC in range.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      keysHeldRef.current.add(event.key);
      if (event.key.toLowerCase() !== "e") return;
      const gameWorld = gameWorldRef.current;
      const dialogue = dialogueRef.current;
      if (gameWorld?.playerEntity === undefined || !dialogue) return;
      const playerTransform = gameWorld.world.get<typeof TransformSchema>(gameWorld.playerEntity, "Transform");
      if (!playerTransform) return;

      let nearestId: string | undefined;
      let nearestDistance = INTERACT_RANGE;
      for (const [placementId, npcEntity] of gameWorld.npcEntitiesByPlacementId) {
        if (!dialogue.dialogueEntityByPlacementId.has(placementId)) continue; // no dialogue configured
        const npcTransform = gameWorld.world.get<typeof TransformSchema>(npcEntity, "Transform");
        if (!npcTransform) continue;
        const distance = Math.hypot(playerTransform.x - npcTransform.x, playerTransform.y - npcTransform.y);
        if (distance <= nearestDistance) {
          nearestDistance = distance;
          nearestId = placementId;
        }
      }
      if (!nearestId) return;
      const dialogueEntity = dialogue.dialogueEntityByPlacementId.get(nearestId)!;
      dialogue.runtime.ctx.events.emit("dialogue:start", { entity: dialogueEntity, treeId: nearestId });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      keysHeldRef.current.delete(event.key);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
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
      {bubble && (
        <div className="fg-preview-app__dialogue" role="status">
          <span className="fg-preview-app__dialogue-speaker">{bubble.speaker}</span>
          <span className="fg-preview-app__dialogue-text">
            <RichDialogueText text={bubble.text} />
          </span>
        </div>
      )}
    </div>
  );
}

function reconcileEntities(gameWorld: GameWorld, entities: readonly EntityPlacement[]): void {
  const { world, npcEntitiesByPlacementId } = gameWorld;

  const playerPlacement = entities.find((entity) => entity.prefabId === "player-start");
  if (playerPlacement && gameWorld.playerEntity === undefined) {
    const { x, y } = tileCenterWorld(playerPlacement.tileX, playerPlacement.tileY);
    gameWorld.playerEntity = spawnPlayer(world, x, y);
  }

  const seenIds = new Set(entities.filter((entity) => entity.prefabId === "npc").map((entity) => entity.id));
  for (const [placementId, entityId] of npcEntitiesByPlacementId) {
    if (seenIds.has(placementId)) continue;
    world.destroy(entityId);
    npcEntitiesByPlacementId.delete(placementId);
  }
  for (const entity of entities) {
    if (entity.prefabId !== "npc") continue;
    const { x, y } = tileCenterWorld(entity.tileX, entity.tileY);
    const existing = npcEntitiesByPlacementId.get(entity.id);
    if (existing === undefined) {
      npcEntitiesByPlacementId.set(entity.id, spawnNpcMarker(world, x, y));
    } else {
      world.set(existing, "Transform", { x, y });
    }
  }

  world.flush();
}

function rebuildDialogueRuntime(
  entities: readonly EntityPlacement[],
  onShown: (payload: { speaker: string; text: string }) => void,
): DialogueRuntime {
  const trees = buildDialogueTreesFromEntities(entities);

  const runtime = createModuleRuntime("@forge/dialogue", { trees });
  dialogueModule.setup(runtime.ctx);
  runtime.events.on("dialogue:shown", (payload) => {
    const { speaker, text } = payload as { speaker: string; text: string };
    onShown({ speaker, text });
  });

  const dialogueEntityByPlacementId = new Map<string, EntityId>();
  for (const tree of trees) {
    dialogueEntityByPlacementId.set(tree.id, runtime.ctx.world.create());
  }
  runtime.world.flush();

  return { runtime, dialogueEntityByPlacementId };
}
