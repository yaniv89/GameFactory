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
  | { readonly type: "scene/delete"; readonly sceneId: string; readonly name: string };

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
  }
}

interface ProjectStoreState {
  document: ProjectDocument;
  past: HistoryEntry[];
  future: HistoryEntry[];
  createScene: () => void;
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
