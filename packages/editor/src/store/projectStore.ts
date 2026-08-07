import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { FormValues } from "../inspector/jsonSchema";

export interface EntityDialogue {
  readonly speaker: string;
  readonly text: string;
}

export interface EntityPlacement {
  readonly id: string;
  readonly kind: "player-start" | "npc";
  readonly tileX: number;
  readonly tileY: number;
  /** Only meaningful for `kind: "npc"` — the one-line dialogue it says on interact (Phase 7). */
  readonly dialogue?: EntityDialogue;
}

export interface SceneSummary {
  readonly id: string;
  readonly name: string;
  /**
   * Not `readonly EntityPlacement[]`: mirrors `ProjectDocument.scenes`
   * itself, a plain mutable array holding readonly-fielded objects —
   * applyCommand mutates the array in place (push/splice), while
   * individual entities are replaced wholesale on change, never patched.
   */
  entities: EntityPlacement[];
}

interface ProjectDocument {
  scenes: SceneSummary[];
  /** Installed module name -> its config values. Presence of the key is the install flag. */
  installedModules: Record<string, FormValues>;
}

/**
 * Serializable, not closures. This is what makes the log persistable
 * (CLAUDE.md 5.3: "Undo has no ceiling within a session and survives
 * reload") and is the same shape M7's Yjs/CRDT relay will eventually need
 * to send ops over the wire — reusing it now instead of inventing a second
 * representation later.
 */
type ProjectCommand =
  | { readonly type: "scene/create"; readonly sceneId: string; readonly name: string }
  | { readonly type: "scene/delete"; readonly sceneId: string; readonly name: string }
  | { readonly type: "scene/rename"; readonly sceneId: string; readonly name: string }
  // Also doubles as "set this installed module's config": applying it
  // upserts unconditionally, so installing and reconfiguring are the same
  // primitive operation.
  | { readonly type: "module/install"; readonly moduleName: string; readonly config: FormValues }
  | { readonly type: "module/uninstall"; readonly moduleName: string }
  | { readonly type: "entity/add"; readonly sceneId: string; readonly entity: EntityPlacement }
  | { readonly type: "entity/delete"; readonly sceneId: string; readonly entityId: string }
  | { readonly type: "entity/configure"; readonly sceneId: string; readonly entityId: string; readonly dialogue: EntityDialogue | undefined }
  // Only one player-start per scene: `entity` undefined means "no player
  // start". Self-inverse-shaped like scene/rename — the inverse just
  // carries whatever the previous value was, including undefined.
  | { readonly type: "entity/set-player-start"; readonly sceneId: string; readonly entity: EntityPlacement | undefined };

interface HistoryEntry {
  readonly forward: ProjectCommand;
  readonly inverse: ProjectCommand;
}

/**
 * The only place that mutates the document. Every command must be
 * self-inverting-by-construction: whoever dispatches one also supplies its
 * exact inverse (see createScene below), so undo/redo never need to
 * reconstruct history from a snapshot — it just replays the log.
 */
function applyCommand(document: ProjectDocument, command: ProjectCommand): void {
  switch (command.type) {
    case "scene/create":
      document.scenes.push({ id: command.sceneId, name: command.name, entities: [] });
      return;
    case "scene/delete": {
      const index = document.scenes.findIndex((scene) => scene.id === command.sceneId);
      if (index !== -1) document.scenes.splice(index, 1);
      return;
    }
    case "scene/rename": {
      const index = document.scenes.findIndex((candidate) => candidate.id === command.sceneId);
      const scene = document.scenes[index];
      // Replaces the element rather than assigning `.name` in place:
      // SceneSummary's fields are readonly by design (Section 3), so a
      // rename is "swap in a new value", not a mutation of the old one.
      if (scene) document.scenes[index] = { id: scene.id, name: command.name, entities: scene.entities };
      return;
    }
    case "module/install":
      document.installedModules[command.moduleName] = command.config;
      return;
    case "module/uninstall":
      delete document.installedModules[command.moduleName];
      return;
    case "entity/add": {
      const scene = document.scenes.find((candidate) => candidate.id === command.sceneId);
      if (scene) scene.entities.push(command.entity);
      return;
    }
    case "entity/delete": {
      const scene = document.scenes.find((candidate) => candidate.id === command.sceneId);
      if (!scene) return;
      const index = scene.entities.findIndex((entity) => entity.id === command.entityId);
      if (index !== -1) scene.entities.splice(index, 1);
      return;
    }
    case "entity/configure": {
      const scene = document.scenes.find((candidate) => candidate.id === command.sceneId);
      if (!scene) return;
      const index = scene.entities.findIndex((entity) => entity.id === command.entityId);
      const entity = scene.entities[index];
      if (!entity) return;
      // exactOptionalPropertyTypes: an optional field can't be assigned
      // `undefined` explicitly — omit the key entirely to clear it.
      const { dialogue: _currentDialogue, ...withoutDialogue } = entity;
      scene.entities[index] =
        command.dialogue !== undefined ? { ...withoutDialogue, dialogue: command.dialogue } : withoutDialogue;
      return;
    }
    case "entity/set-player-start": {
      const scene = document.scenes.find((candidate) => candidate.id === command.sceneId);
      if (!scene) return;
      const index = scene.entities.findIndex((entity) => entity.kind === "player-start");
      if (index !== -1) scene.entities.splice(index, 1);
      if (command.entity) scene.entities.push(command.entity);
      return;
    }
  }
}

/** What the Inspector shows. Scenes, modules, and entities are all selectable, but only one at a time. */
export type Selection =
  | { readonly kind: "scene"; readonly sceneId: string }
  | { readonly kind: "module"; readonly moduleName: string }
  | { readonly kind: "entity"; readonly sceneId: string; readonly entityId: string };

interface ProjectStoreState {
  document: ProjectDocument;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /**
   * What the Inspector is showing. Transient UI focus, not document
   * content — deliberately not part of the command log (selecting
   * something isn't a fact worth undoing) and not persisted (a reload
   * should land on "nothing selected", not resume an old focus target).
   */
  selection: Selection | undefined;
  createScene: () => void;
  renameScene: (sceneId: string, name: string) => void;
  selectScene: (sceneId: string | undefined) => void;
  installModule: (moduleName: string, initialConfig: FormValues) => void;
  uninstallModule: (moduleName: string) => void;
  configureModule: (moduleName: string, config: FormValues) => void;
  selectModule: (moduleName: string | undefined) => void;
  placePlayerStart: (sceneId: string, tileX: number, tileY: number) => void;
  placeNpc: (sceneId: string, tileX: number, tileY: number) => void;
  removeEntity: (sceneId: string, entityId: string) => void;
  configureEntityDialogue: (sceneId: string, entityId: string, dialogue: EntityDialogue) => void;
  selectEntity: (sceneId: string, entityId: string | undefined) => void;
  undo: () => void;
  redo: () => void;
}

const PERSIST_KEY = "forge:editor:project-document";
const PERSIST_VERSION = 1;

export const useProjectStore = create<ProjectStoreState>()(
  persist(
    immer((set) => ({
      document: { scenes: [], installedModules: {} },
      past: [],
      future: [],
      selection: undefined,

      createScene: () =>
        set((state) => {
          const sceneId = crypto.randomUUID();
          const name = `Scene ${state.document.scenes.length + 1}`;
          const forward: ProjectCommand = { type: "scene/create", sceneId, name };
          const inverse: ProjectCommand = { type: "scene/delete", sceneId, name };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      renameScene: (sceneId, name) =>
        set((state) => {
          const scene = state.document.scenes.find((candidate) => candidate.id === sceneId);
          if (!scene || scene.name === name) return;
          const forward: ProjectCommand = { type: "scene/rename", sceneId, name };
          const inverse: ProjectCommand = { type: "scene/rename", sceneId, name: scene.name };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      selectScene: (sceneId) =>
        set((state) => {
          state.selection = sceneId === undefined ? undefined : { kind: "scene", sceneId };
        }),

      installModule: (moduleName, initialConfig) =>
        set((state) => {
          if (moduleName in state.document.installedModules) return; // already installed, no-op
          const forward: ProjectCommand = { type: "module/install", moduleName, config: initialConfig };
          const inverse: ProjectCommand = { type: "module/uninstall", moduleName };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      uninstallModule: (moduleName) =>
        set((state) => {
          const config = state.document.installedModules[moduleName];
          if (config === undefined) return; // not installed, no-op
          const forward: ProjectCommand = { type: "module/uninstall", moduleName };
          const inverse: ProjectCommand = { type: "module/install", moduleName, config };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
          if (state.selection?.kind === "module" && state.selection.moduleName === moduleName) {
            state.selection = undefined;
          }
        }),

      configureModule: (moduleName, config) =>
        set((state) => {
          const previous = state.document.installedModules[moduleName];
          if (previous === undefined || JSON.stringify(previous) === JSON.stringify(config)) return;
          const forward: ProjectCommand = { type: "module/install", moduleName, config };
          const inverse: ProjectCommand = { type: "module/install", moduleName, config: previous };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      selectModule: (moduleName) =>
        set((state) => {
          state.selection = moduleName === undefined ? undefined : { kind: "module", moduleName };
        }),

      placePlayerStart: (sceneId, tileX, tileY) =>
        set((state) => {
          const scene = state.document.scenes.find((candidate) => candidate.id === sceneId);
          if (!scene) return;
          const existing = scene.entities.find((entity) => entity.kind === "player-start");
          const entity: EntityPlacement = { id: crypto.randomUUID(), kind: "player-start", tileX, tileY };
          const forward: ProjectCommand = { type: "entity/set-player-start", sceneId, entity };
          const inverse: ProjectCommand = { type: "entity/set-player-start", sceneId, entity: existing };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      placeNpc: (sceneId, tileX, tileY) =>
        set((state) => {
          const scene = state.document.scenes.find((candidate) => candidate.id === sceneId);
          if (!scene) return;
          const entity: EntityPlacement = { id: crypto.randomUUID(), kind: "npc", tileX, tileY };
          const forward: ProjectCommand = { type: "entity/add", sceneId, entity };
          const inverse: ProjectCommand = { type: "entity/delete", sceneId, entityId: entity.id };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
          // Immediately selecting the new NPC lets the Inspector's
          // dialogue form show up right away — placing and configuring an
          // NPC is meant to feel like one motion, not two.
          state.selection = { kind: "entity", sceneId, entityId: entity.id };
        }),

      removeEntity: (sceneId, entityId) =>
        set((state) => {
          const scene = state.document.scenes.find((candidate) => candidate.id === sceneId);
          const entity = scene?.entities.find((candidate) => candidate.id === entityId);
          if (!scene || !entity) return;
          const forward: ProjectCommand = { type: "entity/delete", sceneId, entityId };
          const inverse: ProjectCommand = { type: "entity/add", sceneId, entity };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
          if (state.selection?.kind === "entity" && state.selection.entityId === entityId) {
            state.selection = undefined;
          }
        }),

      configureEntityDialogue: (sceneId, entityId, dialogue) =>
        set((state) => {
          const scene = state.document.scenes.find((candidate) => candidate.id === sceneId);
          const entity = scene?.entities.find((candidate) => candidate.id === entityId);
          if (!scene || !entity || JSON.stringify(entity.dialogue) === JSON.stringify(dialogue)) return;
          const forward: ProjectCommand = { type: "entity/configure", sceneId, entityId, dialogue };
          const inverse: ProjectCommand = { type: "entity/configure", sceneId, entityId, dialogue: entity.dialogue };
          applyCommand(state.document, forward);
          state.past.push({ forward, inverse });
          state.future = [];
        }),

      selectEntity: (sceneId, entityId) =>
        set((state) => {
          state.selection = entityId === undefined ? undefined : { kind: "entity", sceneId, entityId };
        }),

      undo: () =>
        set((state) => {
          const entry = state.past.pop();
          if (!entry) return;
          applyCommand(state.document, entry.inverse);
          state.future.push(entry);
        }),

      redo: () =>
        set((state) => {
          const entry = state.future.pop();
          if (!entry) return;
          applyCommand(state.document, entry.forward);
          state.past.push(entry);
        }),
    })),
    {
      name: PERSIST_KEY,
      version: PERSIST_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ document: state.document, past: state.past, future: state.future }),
    },
  ),
);

export function selectCanUndo(state: ProjectStoreState): boolean {
  return state.past.length > 0;
}

export function selectCanRedo(state: ProjectStoreState): boolean {
  return state.future.length > 0;
}
