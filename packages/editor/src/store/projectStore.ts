import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

export interface SceneSummary {
  readonly id: string;
  readonly name: string;
}

interface ProjectDocument {
  scenes: SceneSummary[];
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
  | { readonly type: "scene/rename"; readonly sceneId: string; readonly name: string };

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
      document.scenes.push({ id: command.sceneId, name: command.name });
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
      if (scene) document.scenes[index] = { id: scene.id, name: command.name };
      return;
    }
  }
}

interface ProjectStoreState {
  document: ProjectDocument;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /**
   * Which scene the Scenes tree has selected. Transient UI focus, not
   * document content — deliberately not part of the command log (selecting
   * something isn't a fact worth undoing) and not persisted (a reload
   * should land on "nothing selected", not resume an old focus target).
   */
  selectedSceneId: string | undefined;
  createScene: () => void;
  renameScene: (sceneId: string, name: string) => void;
  selectScene: (sceneId: string | undefined) => void;
  undo: () => void;
  redo: () => void;
}

const PERSIST_KEY = "forge:editor:project-document";
const PERSIST_VERSION = 1;

export const useProjectStore = create<ProjectStoreState>()(
  persist(
    immer((set) => ({
      document: { scenes: [] },
      past: [],
      future: [],
      selectedSceneId: undefined,

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
          state.selectedSceneId = sceneId;
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
