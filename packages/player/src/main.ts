import type { EventBusImpl } from "@forge/core";
import { bootGameLogic } from "./gameLogic.js";
// "./generated/*" doesn't exist in the checked-in source tree at all
// (.gitignore's own comment on that path) — forge export (M6 Phase 5e)
// writes both files immediately before running this package's own Vite
// build, one project's data per export.
import { PROJECT_DATA } from "./generated/projectData.js";
import { WASM_BINARY_BASE64 } from "./generated/wasmBinaryBase64.js";
import { bootRenderer } from "./render.js";
import { loadGame, saveGame } from "./save.js";
import { buildWasmModuleFromBase64 } from "./wasmBinary.js";

const AUTOSAVE_INTERVAL_MS = 30_000;
/** Matches PreviewApp.tsx's own DIALOGUE_BUBBLE_MS — the editor's live preview and the real exported player show a line for the same length of time. */
const DIALOGUE_BUBBLE_MS = 3500;

function wireDialogueBubble(events: EventBusImpl): void {
  const bubble = document.querySelector<HTMLDivElement>("#forge-player-dialogue");
  const speakerEl = document.querySelector<HTMLSpanElement>("#forge-player-dialogue-speaker");
  const textEl = document.querySelector<HTMLSpanElement>("#forge-player-dialogue-text");
  if (!bubble || !speakerEl || !textEl) return;

  let hideTimeout: ReturnType<typeof setTimeout> | undefined;
  events.on("dialogue:shown", (payload) => {
    const { speaker, text } = payload as { speaker: string; text: string };
    speakerEl.textContent = speaker;
    textEl.textContent = text;
    bubble.dataset.open = "true";
    clearTimeout(hideTimeout);
    hideTimeout = setTimeout(() => {
      bubble.dataset.open = "false";
    }, DIALOGUE_BUBBLE_MS);
  });
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>("#forge-player-canvas");
  if (!canvas) throw new Error("main: expected a <canvas id=\"forge-player-canvas\"> in index.html");

  const scene = PROJECT_DATA.scenes.find((candidate) => candidate.id === PROJECT_DATA.startSceneId);
  if (!scene) throw new Error(`main: PROJECT_DATA has no scene "${PROJECT_DATA.startSceneId}"`);

  const keysHeld = new Set<string>();
  const wasmModule = await buildWasmModuleFromBase64(WASM_BINARY_BASE64);
  const game = await bootGameLogic({ projectData: PROJECT_DATA, wasmModule, keysHeld });
  wireDialogueBubble(game.events);

  const loaded = loadGame(PROJECT_DATA, game);
  const orphaned: Readonly<Record<string, unknown>> = loaded?.orphaned ?? {};

  await bootRenderer(canvas, PROJECT_DATA, game);

  // save.ts's own persist call needs *the current* scene id, which can now
  // change out from under this closure via "scene:changed" — read it back
  // from the scheduler's own SceneManager rather than closing over the
  // `scene` local above, which only ever reflects the boot-time scene.
  const bootTimeMs = performance.now();
  const currentPlaytimeSec = (): number => (performance.now() - bootTimeMs) / 1000;
  const persist = (): void => saveGame(PROJECT_DATA, game, game.scheduler.scene.currentSceneId, currentPlaytimeSec(), orphaned);

  window.addEventListener("keydown", (event) => {
    keysHeld.add(event.key);
    if (event.key.toLowerCase() === "e") game.interact();
    // Real, host-fed input for any installed module's action-mapped
    // TickContext.input (github.com/yaniv89/GameFactory/issues/3) —
    // .code (layout-independent), unlike keysHeld above, which is the
    // player's own hardcoded WASD/arrow movement and predates this.
    game.scheduler.input.handleKeyDown(event.code);
  });
  window.addEventListener("keyup", (event) => {
    keysHeld.delete(event.key);
    game.scheduler.input.handleKeyUp(event.code);
  });
  canvas.addEventListener("pointerdown", (event) => game.scheduler.input.handlePointerDown(event.button));
  canvas.addEventListener("pointerup", (event) => game.scheduler.input.handlePointerUp(event.button));
  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    game.scheduler.input.handlePointerMove(event.clientX - rect.left, event.clientY - rect.top);
  });
  window.addEventListener("beforeunload", persist);
  setInterval(persist, AUTOSAVE_INTERVAL_MS);
}

main().catch((err: unknown) => {
  console.error("[forge:player] failed to boot", err);
  const root = document.querySelector("#forge-player-root");
  if (root) root.textContent = "This game failed to start. See the browser console for details.";
});
