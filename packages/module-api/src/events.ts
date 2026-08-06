/**
 * Typed pub/sub, per docs/SPEC.md Section 9.3 — "the primary inter-module
 * communication channel." Structurally the same shape as `@forge/core`'s
 * `EventBus` (`packages/core/src/events/eventBus.ts`), independently
 * declared here for the same reason every type in this package is
 * independently declared: `@forge/module-api` may not import
 * `@forge/core` (CLAUDE.md Section 3.1).
 *
 * `EventMap` is deliberately open — a module can publish and subscribe
 * to its own namespaced events (`"@acme/weather-system:seasonChanged"`)
 * as freely as it uses the handful of core-published ones, by supplying
 * its own event-name/payload pairs. There is no fixed, closed event
 * vocabulary the way `InterceptorMap` (`interceptors.ts`) currently is.
 */
export interface EventBus<EventMap extends Record<string, unknown> = Record<string, unknown>> {
  /** Returns an unsubscribe function. */
  on<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): () => void;
  off<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): void;
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void;
}
