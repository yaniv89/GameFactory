import type { EntityId } from "./entity";
import type { WorldApi } from "./world";

/**
 * System scheduling phases, per docs/SPEC.md Section 8.3. Structurally
 * identical to `@forge/core`'s own `Phase` type (`packages/core/src/scheduler/phase.ts`)
 * by design — this is the same fixed-step/per-frame split the engine
 * actually runs, not a separate concept. Independently declared here
 * (not imported) because `@forge/module-api` may not depend on
 * `@forge/core` (CLAUDE.md Section 3.1) — the public contract must stay
 * stable even if the engine's internal phase implementation changes.
 */
export type Phase = "PreUpdate" | "Update" | "PostUpdate" | "Physics" | "PreRender" | "Render" | "UI";

/**
 * A read-only iteration surface over the entities a system's declared
 * `query` matched for the current tick. Per `docs/adr/0005`, this is a
 * snapshot taken once per system per tick — not a live view — so a
 * module reads/writes component data through `TickContext.world`, keyed
 * by the entity ids this yields, not through methods on this object
 * itself.
 */
export interface EntityView {
  /** Total entities matched this tick. */
  readonly count: number;
  /** Iterates every matched entity. No allocation beyond what `fn` itself does. */
  forEach(fn: (entity: EntityId) => void): void;
}

export interface TickContext {
  /** Fixed step, in seconds. Constant across every fixed-step phase invocation this tick. */
  readonly dt: number;
  /** Render interpolation factor, 0..1. Only meaningful during PreRender/Render/UI. */
  readonly alpha: number;
  /** Total simulated time, in seconds. */
  readonly elapsed: number;
  /** Fixed-step counter. */
  readonly frame: number;
  readonly world: WorldApi;
  readonly input: InputSnapshot;
  readonly scene: SceneApi;
}

/**
 * Read-only current-frame input state, sampled once before `PreUpdate`
 * and held constant for the rest of that fixed step. Keyed by the
 * project's named input actions (`docs/SPEC.md` Section 7.3's
 * `settings.inputMaps`), not raw keys — raw key/pointer access requires
 * the `input:raw` capability (`docs/SPEC.md` Section 10.3) and is not
 * part of this base surface.
 */
export interface InputSnapshot {
  isActionDown(action: string): boolean;
  wasActionPressed(action: string): boolean;
  wasActionReleased(action: string): boolean;
  readonly pointerPosition: { readonly x: number; readonly y: number };
}

/** Minimal scene query/transition surface. Additive room for camera/layer queries later. */
export interface SceneApi {
  readonly currentSceneId: string;
  transitionTo(sceneId: string): void;
}

export interface SystemDefinition {
  /** Namespaced, e.g. `"@acme/weather-system:ApplyWindForce"`. Must be unique across the whole world, not just this phase. */
  readonly id: string;
  readonly phase: Phase;
  readonly query: readonly string[];
  /** System ids that must run before this one, within the same phase. */
  readonly before?: readonly string[];
  /** System ids that must run after this one, within the same phase. */
  readonly after?: readonly string[];
  /** Skip `run()` when `query` matches nothing this tick. Default `true`. */
  readonly skipIfEmpty?: boolean;
  run(ctx: TickContext, entities: EntityView): void;
}
