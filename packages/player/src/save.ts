import { createSave, loadSave } from "@forge/runtime-host";
import type { SaveFile } from "@forge/module-api";
import type { GameLogic } from "./gameLogic.js";
import type { PlayerProjectData } from "./playerProjectData.js";

const SAVE_KEY_PREFIX = "forge:save:";

/**
 * docs/SPEC.md Section 15.3: `--standalone` "disables cloud saves...
 * and falls back to `localStorage` saves" — non-negotiable for v1, per
 * CLAUDE.md. `createSave`/`loadSave` (`@forge/runtime-host`) already do
 * the real work (world + per-module storage serialization, version
 * migration); this is just where they land for an exported build —
 * `localStorage`, keyed per project so more than one exported game on
 * the same origin (a `file://` directory of several exports, or several
 * games served from the same static host) doesn't collide.
 */
function saveKeyFor(projectId: string): string {
  return `${SAVE_KEY_PREFIX}${projectId}`;
}

export function saveGame(
  projectData: PlayerProjectData,
  game: GameLogic,
  currentSceneId: string,
  playtimeSec: number,
  orphaned: Readonly<Record<string, unknown>>,
): void {
  const save = createSave({
    world: game.world,
    modules: game.bridges,
    schemaVersion: projectData.schemaVersion,
    engineVersion: projectData.engineVersion,
    projectId: projectData.projectId,
    buildId: projectData.buildId,
    playtimeSec,
    flags: {},
    currentScene: currentSceneId,
    orphaned,
  });
  localStorage.setItem(saveKeyFor(projectData.projectId), JSON.stringify(save));
}

export interface LoadedGame {
  /** Feed back into the next `saveGame()` call so a module that gets uninstalled/reinstalled between sessions doesn't lose its data — see `loadSave`'s own doc comment. */
  readonly orphaned: Readonly<Record<string, unknown>>;
}

/** `undefined` when there is no save yet for this project — a fresh game, not an error. */
export function loadGame(projectData: PlayerProjectData, game: GameLogic): LoadedGame | undefined {
  const raw = localStorage.getItem(saveKeyFor(projectData.projectId));
  if (!raw) return undefined;
  const save = JSON.parse(raw) as SaveFile;
  return loadSave(game.world, game.bridges, save);
}
