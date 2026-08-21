import type { EventBus } from "./events";
import type { WorldApi } from "./world";

/**
 * docs/adr/0017 (J1's node-graph authoring layer). Formalized here at M4,
 * per Decision 4's own task split — this type previously lived
 * provisionally in `@forge/graph-nodes-core` (M2) so `@forge/module-api`
 * wasn't locked into a shape only one consumer had exercised; M3's React
 * Flow editor and M2's core node library have both now exercised it, so
 * it moves to its permanent, additive-only/semver-disciplined home
 * (CLAUDE.md Section 3.1).
 *
 * A node is "pure" (no side effect, evaluated on demand as an input to
 * whatever needs its value) if neither `inputs` nor `outputs` contains a
 * `"flow"`-typed socket, or "impure"/an action node (executed in sequence,
 * one flow edge at a time) if it does — the same pure/impure split
 * Blueprint-style graphs use. An impure node's `execute()` must call
 * `ctx.next()` exactly once per invocation, naming one of its own
 * `"flow"`-typed output sockets; a pure node must never call it.
 */
export type GraphSocketType = "flow" | "number" | "string" | "boolean" | "entity" | "any";

export interface GraphSocketDefinition {
  readonly name: string;
  readonly type: GraphSocketType;
}

/**
 * The runtime half of a node's contract — the pure function
 * `@forge/graph-runtime` (M5) actually calls once a graph is compiled.
 * Deliberately narrow: no `log`, no direct sandbox access beyond `world`/
 * `events` — a node gets exactly the same surface an ordinary
 * hand-written module's system already gets from `TickContext`, nothing
 * wider (docs/adr/0017 Decision 1: a graph can never do anything a
 * hand-written module couldn't already do).
 */
export interface GraphNodeExecutionContext {
  readonly world: WorldApi;
  readonly events: EventBus;
  /**
   * Every data table in the project (docs/adr/0018 Decision 3) — the
   * identical value the owning module's own `SetupContext.dataTables`
   * carries, threaded through by `@forge/graph-runtime`'s interpreter
   * when it builds this context for a node call. Lets `core:lookupRow`/
   * `core:tableRowCount` (`@forge/graph-nodes-core`) read project data
   * directly, the same "graph reads project data without a module in
   * between" pattern `core:getComponent`/`core:getField` already
   * establish for components/event payloads.
   */
  readonly dataTables: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  /**
   * Impure nodes only: tells the interpreter which of this node's own
   * `"flow"`-typed output sockets to continue down. `flowOutput` must
   * name one of `outputs` — the interpreter (M5), not the node itself,
   * enforces that at compile time (docs/adr/0017 Decision 5: the runtime
   * never trusts that the editor already validated this).
   */
  next(flowOutput: string): void;
  /**
   * Attributable diagnostics for a node's own locally-detectable problems
   * (a clamped "repeat" count, a divide-by-zero) — the same "a non-
   * programmer whose graph 'just doesn't work' has no way to debug that"
   * concern docs/adr/0017 Decision 3 raises, answered the same way
   * `@forge/dialogue`'s `validateTrees` already answers it: never silent.
   */
  warn(message: string, data?: Record<string, unknown>): void;
}

/**
 * The full contract for one node *type* (e.g. `"core:add"` or
 * `"acme:spawnLoot"`), not one placed instance of it on a graph —
 * matching how `SystemDefinition` describes a system's shape once,
 * reused for every entity it matches. `execute()` runs once per
 * invocation of that node instance in the interpreted graph and must be
 * a plain, synchronous function: no awaiting, no closures over mutable
 * module-level state, nothing that would make one node instance's
 * execution observable from another's — the same statelessness
 * `@forge/core` systems already hold to.
 *
 * Registered via `SetupContext.defineGraphNode` (`module.ts`) — the same
 * "called once from a module's own sandboxed `setup()`" pattern
 * `defineComponent`/`addSystem`/`addInterceptor` already use. A
 * third-party module registers its own node types exactly the same way a
 * first-party one does, declaring them in its manifest's existing
 * `provides.graphNodes` array — no second plugin mechanism.
 */
export interface GraphNodeDefinition {
  /** Namespaced, e.g. `"core:add"` or `"acme:spawnLoot"` — matches a manifest's `provides.graphNodes` entry. */
  readonly type: string;
  readonly inputs: readonly GraphSocketDefinition[];
  readonly outputs: readonly GraphSocketDefinition[];
  execute(
    ctx: GraphNodeExecutionContext,
    inputs: Readonly<Record<string, unknown>>,
    config: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> | void;
}
