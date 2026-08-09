/** System scheduling phases, per docs/SPEC.md Section 8.3, in run order. */
export type Phase =
  | "PreUpdate"
  | "Update"
  | "PostUpdate"
  | "Physics"
  | "PreRender"
  | "Render"
  | "UI";

/** Fixed-step phases run inside the accumulator loop; the rest run once per animation frame. */
export const FIXED_STEP_PHASES: readonly Phase[] = ["PreUpdate", "Update", "PostUpdate", "Physics"];

export const PER_FRAME_PHASES: readonly Phase[] = ["PreRender", "Render", "UI"];

export const PHASE_ORDER: readonly Phase[] = [...FIXED_STEP_PHASES, ...PER_FRAME_PHASES];

/** 60Hz fixed step, in milliseconds. Per docs/SPEC.md Section 8.2. */
export const FIXED_STEP_MS = 1000 / 60;

/** Per docs/SPEC.md Section 8.2: caps the accumulator so a backgrounded tab can't trigger the spiral of death. */
export const MAX_ACCUMULATED_MS = 250;
