/**
 * Capability-gated API shapes, per docs/SPEC.md Section 10.3. Each of
 * these is present on `SetupContext` only if the module's manifest
 * declared the matching capability and the runtime granted it — see
 * `module.ts`.
 *
 * `audio` and `render` (Section 10.3's other two capabilities) are
 * deliberately not in this file yet: `packages/runtime-host`'s
 * capability bridge (M2 Phase 4) only has real implementations for
 * `storage:local` and `network` so far. Per CLAUDE.md's "refuse to fake
 * it," this package does not publish method signatures for capabilities
 * nothing implements — adding them later is an additive, non-breaking
 * change; guessing wrong now and having to change it later would not be.
 */

/** `storage:local` — namespaced save data, implicit consent at install. */
export interface StorageApi {
  get<T = unknown>(key: string): T | null;
  set<T = unknown>(key: string, value: T): void;
  delete(key: string): void;
}

/** `network` — `fetch` to a declared allowlist of domains, explicit consent. The dangerous one; see docs/security/SANDBOX-DESIGN.md Section 4.1. */
export interface NetApi {
  fetch(url: string): Promise<{ readonly status: number; readonly ok: boolean; readonly body: string }>;
}

/**
 * Always present, regardless of granted capabilities — logging is
 * baseline infrastructure, not a permission a module opts into. Every
 * call is attributed to the emitting module (name + version) host-side,
 * per the interaction law that errors are "attributed to the specific
 * module, version, and author responsible," not surfaced as generic
 * platform noise.
 */
export interface Logger {
  debug(message: string, data?: Readonly<Record<string, unknown>>): void;
  info(message: string, data?: Readonly<Record<string, unknown>>): void;
  warn(message: string, data?: Readonly<Record<string, unknown>>): void;
  error(message: string, data?: Readonly<Record<string, unknown>>): void;
}
