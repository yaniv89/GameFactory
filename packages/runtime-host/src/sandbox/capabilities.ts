/** Per docs/SPEC.md Section 10.3's capability table. */
export type CapabilityName =
  | "render"
  | "audio"
  | "storage:local"
  | "storage:global"
  | "network"
  | "input:raw"
  | "clipboard"
  | "player-identity";

/**
 * One capability's host-side implementation, wired into a `ModuleRuntime`
 * only if the host explicitly passed it — never derived from anything the
 * module itself claims. Per docs/security/SANDBOX-DESIGN.md Section 4,
 * every argument and return value crosses the host/guest boundary as
 * JSON, decomposed to primitives; no live object or function reference
 * is ever exposed.
 */
export interface CapabilityHandler {
  readonly capability: CapabilityName;
  /** Property name this capability appears under on the guest's `globalThis`, e.g. `"storage"` for `storage:local`. */
  readonly globalName: string;
  /** Method names routed to `call()`. Anything not listed here is not exposed as a sync method, even if `call()` would technically handle it. */
  readonly syncMethods?: readonly string[];
  /** Method names routed to `callAsync()`. */
  readonly asyncMethods?: readonly string[];
  /** Handles a call declared in `syncMethods`. Return a JSON-serializable value, or throw — a thrown Error surfaces as a catchable exception in the guest. */
  call?(method: string, args: readonly unknown[]): unknown;
  /** Handles a call declared in `asyncMethods`. Resolve with a JSON-serializable value, or reject. */
  callAsync?(method: string, args: readonly unknown[]): Promise<unknown>;
}
