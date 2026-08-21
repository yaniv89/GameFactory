import type { NetApi, StorageApi, Logger } from "./capabilities";
import type { ComponentHandle, ComponentJsonSchema, ComponentShape } from "./component";
import type { EventBus } from "./events";
import type { GraphNodeDefinition } from "./graph";
import type { InterceptorContext, InterceptorMap } from "./interceptors";
import type { SystemDefinition } from "./scheduler";
import type { WorldApi } from "./world";

/**
 * The complete public surface a runtime module sees. Per CLAUDE.md
 * Section 9.1's design rule #1: "everything a first-party Module can do,
 * a third-party Module can do" — `@forge/dialogue`, `@forge/inventory`,
 * and `@forge/turn-battle` (Milestone M3) are built against exactly this
 * interface, nothing more, enforced by
 * `tools/security/check-module-boundaries.mjs`.
 *
 * ⚠ Not the full surface docs/SPEC.md Section 9.3 eventually describes:
 * the `audio`/`render` capabilities (no bridge implementation yet — see
 * `capabilities.ts`) are deliberately absent from v1 rather than guessed
 * at. Adding them later is additive; this omission is itself the record
 * of that decision, not a silent gap. `defineGraphNode` (below) *was*
 * absent for the same reason until docs/adr/0017 (J1's node-graph
 * authoring layer) resolved Section 22 Open Question 1 and M4 formalized
 * the shape M2/M3 had already exercised provisionally.
 */
export interface ForgeModule {
  /** Called once at world construction, before any scene loads. */
  setup(ctx: SetupContext): void | Promise<void>;
  /** Called when the world is torn down. Release all resources here. */
  teardown?(ctx: TeardownContext): void;
  /** Required if `saveSchemaVersion` (manifest) has ever been bumped. */
  migrateSave?(from: number, to: number, data: unknown): unknown;
}

export interface SetupContext {
  /** Validated against the manifest's `configSchema`. */
  readonly config: Readonly<Record<string, unknown>>;
  readonly engineVersion: string;
  readonly moduleName: string;
  /**
   * A live `WorldApi`, per docs/adr/0006 — available from `setup()` itself
   * and, via closure over `ctx`, from any `events.on()` handler. Each
   * method here is one immediate host round trip (like
   * `InterceptorContext.world`), not the per-tick batched view
   * `TickContext.world` gives a running system (docs/adr/0005) — neither
   * `setup()` nor an event handler runs at per-entity, per-tick
   * frequency, so there's no batching win to chase here.
   */
  readonly world: WorldApi;

  defineComponent<T extends ComponentShape>(name: string, schema: ComponentJsonSchema, defaults: T): ComponentHandle<T>;
  /**
   * `def.run` is a callback the *host* invokes once per matching tick —
   * the reverse direction from the request/response capability calls in
   * `capabilities.ts`. Implementing that (the host calling back into a
   * guest-registered function, per `docs/adr/0005`'s batched-snapshot
   * design) is `packages/runtime-host`'s module-bridge work, not
   * something this types-only package does.
   */
  addSystem(def: SystemDefinition): void;

  /** The primary inter-module communication channel — docs/SPEC.md Section 9.3. */
  readonly events: EventBus;
  /** The WordPress-"filter" mechanism — docs/SPEC.md Section 9.4. `fn`, like `addSystem`'s `run`, is a host-invoked callback into guest code. */
  addInterceptor<K extends keyof InterceptorMap>(
    point: K,
    priority: number,
    fn: (value: InterceptorMap[K], ctx: InterceptorContext) => InterceptorMap[K],
  ): void;
  /**
   * Triggers the shared filter chain for `point` — the counterpart to
   * `addInterceptor`, per docs/adr/0006. Use this when your module *owns*
   * a named interception point (e.g. `@forge/dialogue` computing a line
   * to show, then giving every other module's registered `dialogue:line`
   * filter a chance to transform it before displaying it):
   *
   * ```ts
   * const line = ctx.runInterceptor("dialogue:line", {
   *   speaker: "Shopkeeper",
   *   text: "Welcome to my shop.",
   *   locale: "en",
   * });
   * // line.text may have been rewritten by a translation module's filter.
   * ```
   *
   * Runs every module's registered filter for `point`, in priority order,
   * including filters registered by modules other than the caller. Your
   * module does not need to have called `addInterceptor` for `point`
   * itself — in the common case (you own the point, another module
   * filters it) it won't have. Returns `value` unchanged if no filter is
   * registered for `point`.
   */
  runInterceptor<K extends keyof InterceptorMap>(point: K, value: InterceptorMap[K]): InterceptorMap[K];

  /**
   * Registers one node type (`graph.ts`) for `@forge/graph-runtime` (M5)
   * to interpret — the same "called once from `setup()`" shape
   * `defineComponent`/`addSystem`/`addInterceptor` already use, so a
   * third-party module registers its own node types no differently than
   * a first-party one does (docs/adr/0017 Decision 4). Declare the
   * resulting type name(s) in the module's manifest `provides.graphNodes`
   * array too — that's what makes the registration discoverable before
   * any graph starts interpreting, the same way `provides.components`
   * documents what `defineComponent` calls to expect.
   */
  defineGraphNode(def: GraphNodeDefinition): void;

  /** Namespaced key-value store, persisted into the save file. Always present — `storage:local` is implicit-consent (docs/SPEC.md Section 10.3). */
  readonly storage: StorageApi;
  /** Only present if the `network` capability was granted. */
  readonly net?: NetApi;
  /** Always present — logging is baseline infrastructure, not a capability. */
  readonly log: Logger;
}

export interface TeardownContext {
  readonly moduleName: string;
}
