import { registerCoreComponents, Scheduler, TransformSchema, World, type EntityId } from "@forge/core";
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
import { Sprite } from "pixi.js";
import { useEffect, useRef, useState } from "react";
import { buildEntityTextures } from "../canvas/entityMarkers";
import { GRID_HEIGHT, GRID_WIDTH, TILE_SIZE } from "../canvas/gridConstants";
import { WALL_TILE_ID, buildPaletteTextures } from "../canvas/tilePalette";
import type { EntityPlacement } from "../store/projectStore";
import { createModuleRuntime } from "./directModuleHost";
import { INTERACT_RANGE, NPC_ASSET_ID, PLAYER_ASSET_ID, createPlayerMovementSystem, spawnNpcMarker, spawnPlayer } from "./gameWorld";
import { TRUSTED_EDITOR_ORIGIN } from "./origins";
import { isPreviewSceneMessage } from "./protocol";
import { RichDialogueText } from "./RichDialogueText";
import "./PreviewApp.css";

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

function fitZoom(viewportWidth: number, viewportHeight: number): number {
  const worldWidth = GRID_WIDTH * TILE_SIZE;
  const worldHeight = GRID_HEIGHT * TILE_SIZE;
  if (worldWidth <= 0 || worldHeight <= 0) return 1;
  return Math.min(viewportWidth / worldWidth, viewportHeight / worldHeight);
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
        scheduler.addSystem(
          createSpriteSyncSystem({
            world,
            container: host.worldContainer,
            snapshots,
            createSprite: () => new Sprite(),
            resolveTexture: (assetId: number) => entityTextures.get(assetId === PLAYER_ASSET_ID ? "player-start" : "npc"),
          }),
        );
        gameWorldRef.current = { world, scheduler, playerEntity: undefined, npcEntitiesByPlacementId: new Map() };

        const onTick = (ticker: { deltaMS: number }) => scheduler.tick(ticker.deltaMS);
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
      rig.host.resize(width, height);
      rig.camera.resizeViewport(width, height);
      rig.camera.zoom = fitZoom(width, height);
      rig.camera.applyTo(rig.host.worldContainer);
      rig.layer.cull(rig.camera.visibleWorldBounds());
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
      const { tiles, entities } = event.data;

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
