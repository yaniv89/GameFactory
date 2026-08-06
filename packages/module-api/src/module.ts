import type { NetApi, StorageApi, Logger } from "./capabilities";
import type { ComponentHandle, ComponentJsonSchema, ComponentShape } from "./component";
import type { EventBus } from "./events";
import type { InterceptorContext, InterceptorMap } from "./interceptors";
import type { SystemDefinition } from "./scheduler";

/**
 * The complete public surface a runtime module sees. Per CLAUDE.md
 * Section 9.1's design rule #1: "everything a first-party Module can do,
 * a third-party Module can do" — `@forge/dialogue`, `@forge/inventory`,
 * and `@forge/turn-battle` (Milestone M3) are built against exactly this
 * interface, nothing more, enforced by
 * `tools/security/check-module-boundaries.mjs`.
 *
 * ⚠ Not the full surface docs/SPEC.md Section 9.3 eventually describes:
 * `defineGraphNode` (no graph VM exists yet — Section 22 Open Question 1
 * is still open) and the `audio`/`render` capabilities (no bridge
 * implementation yet — see `capabilities.ts`) are deliberately absent
 * from v1 rather than guessed at. Adding them later is additive; this
 * omission is itself the record of that decision, not a silent gap.
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
