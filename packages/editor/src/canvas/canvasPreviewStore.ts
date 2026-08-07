import { create } from "zustand";

/**
 * Bridges SceneCanvas's live, in-memory tile edits to the Preview panel.
 * Dockview mounts sibling panels independently — there's no parent
 * component to thread a prop between them — so this is the shared point
 * of truth, the same role projectStore plays between ScenesPanel and
 * InspectorPanel. Deliberately its own tiny store, not folded into
 * projectStore: this is transient render output for the preview, not
 * project document content (SceneCanvas's tiles aren't persisted or
 * undoable yet either — see SceneCanvas's own doc comment).
 */
export interface CanvasPreviewState {
  tiles: readonly number[] | undefined;
  setTiles: (tiles: readonly number[]) => void;
}

export const useCanvasPreviewStore = create<CanvasPreviewState>((set) => ({
  tiles: undefined,
  setTiles: (tiles) => set({ tiles }),
}));
