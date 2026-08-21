import type { EventBus, WorldApi } from "@forge/module-api";

/**
 * Provisional — lives here, not `@forge/module-api`, until M4 formalizes
 * `GraphNodeDefinition` there (docs/adr/0017 Decision 4's own task split:
 * "M4 ... mostly already implied by M2/M3's own shape, made explicit and
 * tested here"). `@forge/graph-runtime` (M5) and the M3 React Flow editor
 * both consume this exact shape once they exist; M4 is what promotes it
 * into the public, additive-only/semver-disciplined surface (CLAUDE.md
 * Section 3.1) after both have had a chance to exercise it, rather than
 * locking it into `@forge/module-api` from a single consumer's guess.
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
 * `@forge/graph-runtime` (M5) actually calls once the graph is compiled.
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
   * Impure nodes only: tells the interpreter which of this node's own
   * `"flow"`-typed output sockets to continue down. `flowOutput` must
   * name one of `outputs` — the interpreter (M5), not this package,
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
 * The full contract for one node *type* (e.g. `"core:add"`), not one
 * placed instance of it on a graph — matching how `SystemDefinition`
 * describes a system's shape once, reused for every entity it matches.
 * `execute()` runs once per invocation of that node instance in the
 * interpreted graph and must be a plain, synchronous function: no
 * awaiting, no closures over mutable module-level state, nothing that
 * would make one node instance's execution observable from another's —
 * the same statelessness `@forge/core` systems already hold to.
 */
export interface GraphNodeDefinition {
  /** Namespaced, e.g. `"core:add"` or `"acme:spawnLoot"` — matches a manifest's `provides.graphNodes` entry once M4 wires registration through `defineGraphNode`. */
  readonly type: string;
  readonly inputs: readonly GraphSocketDefinition[];
  readonly outputs: readonly GraphSocketDefinition[];
  execute(
    ctx: GraphNodeExecutionContext,
    inputs: Readonly<Record<string, unknown>>,
    config: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> | void;
}
