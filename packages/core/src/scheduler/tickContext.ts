import type { World } from "../ecs/world";

/** Per docs/SPEC.md Section 9.3. Passed to every system's `run()` for one phase execution. */
export interface TickContext {
  /** Fixed step, in seconds. Constant across every fixed-step phase invocation. */
  readonly dt: number;
  /** Render interpolation factor, 0..1. Only meaningful during PreRender/Render/UI. */
  readonly alpha: number;
  /** Total simulated time, in seconds, advanced once per fixed step. */
  readonly elapsed: number;
  /** Fixed-step counter. Advances once per fixed step, not once per rendered frame. */
  readonly frame: number;
  readonly world: World;
}
