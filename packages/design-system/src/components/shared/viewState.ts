/**
 * The six states every data-bearing view must design for (CLAUDE.md 5.4).
 * Shared by Panel and Tree — the two primitives in this package whose job
 * is literally to render a collection of something that can be loading,
 * empty, errored, restricted, or offline.
 */
export type ViewState =
  | "loading"
  | "empty"
  | "error"
  | "permission-denied"
  | "offline"
  | "populated";
