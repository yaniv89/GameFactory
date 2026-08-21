import type { EventBus, GraphNodeExecutionContext, WorldApi } from "@forge/module-api";
import type { CompiledGraph, CompiledNode } from "./compileGraph";

// A structural bound independent of the sandbox's own per-tick compute
// budget (docs/adr/0017 Decision 3: "a second independent control on the
// same risk") — catches a degenerate but acyclic long flow chain with a
// clear, attributable message instead of silently hammering the compute
// interrupt.
const MAX_FLOW_STEPS = 10_000;
const MAX_EVAL_DEPTH = 1_000;
// core:repeat/core:forEachEntity recurse into a fresh walkFlow per
// iteration (below) — bounds how deeply loop bodies can nest inside each
// other, on top of each individual repeat's own count ceiling
// (@forge/graph-nodes-core's own ABSOLUTE_REPEAT_CEILING — core:repeat's
// execute() is what actually enforces that one, not this file).
const MAX_LOOP_NESTING_DEPTH = 20;

export type GraphWarn = (message: string, data?: Record<string, unknown>) => void;

interface Env {
  readonly graph: CompiledGraph;
  readonly world: WorldApi;
  readonly events: EventBus;
  readonly dataTables: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  readonly warn: GraphWarn;
}

/** Binds one `forEachEntity` node's `"entity"` output socket to the current iteration's value, for the duration of one loop-body walk — the interpreter-owned per-iteration data `core:forEachEntity`'s own `execute()` can't produce on its own (see its doc comment in `@forge/graph-nodes-core`). */
interface LoopBinding {
  readonly nodeId: string;
  readonly socketName: string;
  readonly value: unknown;
}

/**
 * The real, already-executed outputs of every impure node touched so far
 * during the current external-event activation — one map per
 * `attachGraph`-installed `events.on` callback firing, shared across the
 * *entire* `walkFlow` call tree for that firing (including every
 * recursive loop-body walk). This is what a downstream data edge whose
 * source is an impure node (e.g. `core:onEvent`'s `payload`,
 * `core:createEntity`'s `entity`) actually reads from — never by calling
 * that node's `execute()` a second time, which would silently repeat its
 * side effect (a second entity created, a second destroy, a second
 * emitted event) the moment two different downstream nodes wanted its
 * data. Populated by `runImpureNode` immediately after each real
 * execution, before flow moves on to whatever's next.
 */
type ImpureOutputs = Map<string, Record<string, unknown>>;

function socketKey(nodeId: string, socketName: string): string {
  return `${nodeId}:${socketName}`;
}

function isImpure(node: CompiledNode): boolean {
  return node.definition.inputs.some((s) => s.type === "flow") || node.definition.outputs.some((s) => s.type === "flow");
}

function makeExecutionContext(env: Env, node: CompiledNode, onNext: (flowOutput: string) => void): GraphNodeExecutionContext {
  return {
    world: env.world,
    events: env.events,
    dataTables: env.dataTables,
    next: onNext,
    warn: (message, data) => env.warn(`graph "${env.graph.name}", node "${node.id}" (${node.type}): ${message}`, data),
  };
}

/**
 * Resolves one node's outputs for a data edge — an impure source is read
 * (never re-executed) from `impureOutputs`; a genuinely pure source (no
 * flow socket at all) is evaluated on demand via `evaluatePureNode`.
 * Either way, `loop`'s per-iteration override is applied last, so it wins
 * over whatever `execute()` itself returned — the same
 * "declared here, actually supplied by the interpreter" treatment
 * `core:onEvent`'s `payload` input and `core:forEachEntity`'s `entity`
 * output both get in `@forge/graph-nodes-core`'s own doc comments.
 * Cached in `memo` for the remainder of one impure node's own input
 * resolution (one `runImpureNode` call) purely to avoid redundant
 * re-evaluation of a pure node read by more than one sibling input in
 * that same call — not a correctness requirement, since a pure
 * evaluation has no side effect to duplicate.
 */
function resolveNodeOutputs(
  env: Env,
  nodeId: string,
  impureOutputs: ImpureOutputs,
  memo: Map<string, Record<string, unknown>>,
  evaluating: Set<string>,
  loop: LoopBinding | undefined,
  depth: number,
): Record<string, unknown> {
  const cached = memo.get(nodeId);
  if (cached) return cached;

  const node = env.graph.nodes.get(nodeId);
  if (!node) throw new Error(`graph "${env.graph.name}": unknown node "${nodeId}" referenced by a data edge`);

  let outputs: Record<string, unknown>;
  if (isImpure(node)) {
    const recorded = impureOutputs.get(nodeId);
    if (!recorded) {
      env.warn(
        `graph "${env.graph.name}": a data edge reads node "${nodeId}" (${node.type})'s output before that node has run in this flow — using an empty result instead of re-running it (re-running would repeat its side effect)`,
      );
      outputs = {};
    } else {
      outputs = recorded;
    }
  } else {
    outputs = evaluatePureNode(env, nodeId, node, impureOutputs, memo, evaluating, loop, depth);
  }

  if (loop && loop.nodeId === nodeId) outputs = { ...outputs, [loop.socketName]: loop.value };
  memo.set(nodeId, outputs);
  return outputs;
}

/** Resolves every non-flow input socket for `node`: a wired data edge takes priority, then an interpreter-supplied explicit value (e.g. a trigger's own event payload), then `undefined`. */
function resolveInputs(
  env: Env,
  node: CompiledNode,
  explicitInputs: Readonly<Record<string, unknown>>,
  impureOutputs: ImpureOutputs,
  memo: Map<string, Record<string, unknown>>,
  evaluating: Set<string>,
  loop: LoopBinding | undefined,
  depth: number,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  for (const socket of node.definition.inputs) {
    if (socket.type === "flow") continue;
    const edge = env.graph.incomingData.get(socketKey(node.id, socket.name));
    if (edge) {
      const sourceOutputs = resolveNodeOutputs(env, edge.source, impureOutputs, memo, evaluating, loop, depth);
      inputs[socket.name] = sourceOutputs[edge.sourceHandle];
    } else if (socket.name in explicitInputs) {
      inputs[socket.name] = explicitInputs[socket.name];
    }
  }
  return inputs;
}

/**
 * Evaluates a genuinely pure node (no flow socket at all) on demand.
 * Never called for an impure source — `resolveNodeOutputs` routes those
 * to `impureOutputs` instead, specifically so this function is never the
 * thing that silently re-runs a side effect. Cycle-guarded via
 * `evaluating` (defense in depth — `compileGraph` already rejects any
 * cycle, data or flow, at compile time).
 */
function evaluatePureNode(
  env: Env,
  nodeId: string,
  node: CompiledNode,
  impureOutputs: ImpureOutputs,
  memo: Map<string, Record<string, unknown>>,
  evaluating: Set<string>,
  loop: LoopBinding | undefined,
  depth: number,
): Record<string, unknown> {
  if (depth > MAX_EVAL_DEPTH) {
    throw new Error(`graph "${env.graph.name}": exceeded max data-evaluation depth (${MAX_EVAL_DEPTH}) resolving node "${nodeId}"`);
  }
  if (evaluating.has(nodeId)) {
    throw new Error(`graph "${env.graph.name}": cycle detected evaluating node "${nodeId}" at runtime (compileGraph should already have rejected this)`);
  }

  evaluating.add(nodeId);
  try {
    const inputs = resolveInputs(env, node, {}, impureOutputs, memo, evaluating, loop, depth + 1);
    const ctx = makeExecutionContext(env, node, () => {
      throw new Error(`graph "${env.graph.name}": node "${nodeId}" (${node.type}) called next() while being evaluated for its data outputs — only the active flow node may call next()`);
    });
    return node.definition.execute(ctx, inputs, node.config) ?? {};
  } finally {
    evaluating.delete(nodeId);
  }
}

/**
 * Runs one impure node once (its own side effect, plus whichever flow
 * output it names via `next()`), with a fresh per-call `memo`/`evaluating`
 * for resolving its data inputs — recomputing a pure dependency fresh
 * for each impure node reached is deliberate, not an oversight: a pure
 * node's inputs (e.g. a `forEachEntity` loop's current `entity`) can
 * differ between flow steps, so nothing here would be safe to reuse
 * beyond one node's own resolution. Records the real outputs into
 * `impureOutputs` immediately, before returning, so any later node in the
 * same activation that reads this one's data gets the real result instead
 * of triggering a second, duplicate execution.
 */
function runImpureNode(
  env: Env,
  node: CompiledNode,
  explicitInputs: Readonly<Record<string, unknown>>,
  impureOutputs: ImpureOutputs,
  loop: LoopBinding | undefined,
): { outputs: Record<string, unknown>; nextFlowOutput: string | undefined } {
  const memo = new Map<string, Record<string, unknown>>();
  const evaluating = new Set<string>();
  const inputs = resolveInputs(env, node, explicitInputs, impureOutputs, memo, evaluating, loop, 0);
  let nextFlowOutput: string | undefined;
  const ctx = makeExecutionContext(env, node, (flowOutput) => {
    nextFlowOutput = flowOutput;
  });
  const outputs = node.definition.execute(ctx, inputs, node.config) ?? {};
  impureOutputs.set(node.id, outputs);
  return { outputs, nextFlowOutput };
}

/**
 * Walks a flow chain starting at `startNodeId`, one impure node at a
 * time, following each node's own `next()` choice through
 * `graph.outgoingFlow`. `core:repeat`/`core:forEachEntity` are the two
 * bounded-iteration nodes from docs/adr/0017 Decision 3 — their own
 * `execute()` only resolves the bound (a clamped count, a matched entity
 * list); this function is what actually performs the repeated walk,
 * exactly the "interpreter owns the mechanism" split their own doc
 * comments in `@forge/graph-nodes-core` describe. A real, stated v1
 * limitation: since both nodes have exactly one flow output (no separate
 * "loop body" vs. "after the loop" socket — that's `@forge/graph-nodes-core`'s
 * own M2 socket shape, not something this interpreter works around), that
 * output *is* the loop body, and nothing continues linearly after either
 * node finishes its iterations.
 */
function walkFlow(
  env: Env,
  startNodeId: string,
  initialInputs: Readonly<Record<string, unknown>>,
  impureOutputs: ImpureOutputs,
  loop: LoopBinding | undefined,
  depth: number,
): void {
  if (depth > MAX_LOOP_NESTING_DEPTH) {
    env.warn(`graph "${env.graph.name}": exceeded max loop nesting depth (${MAX_LOOP_NESTING_DEPTH})`);
    return;
  }

  let currentNodeId: string | undefined = startNodeId;
  let currentInputs = initialInputs;
  let steps = 0;

  while (currentNodeId) {
    if (++steps > MAX_FLOW_STEPS) {
      env.warn(`graph "${env.graph.name}": exceeded max flow steps (${MAX_FLOW_STEPS}) starting from node "${startNodeId}"`);
      return;
    }
    const node = env.graph.nodes.get(currentNodeId);
    if (!node) {
      env.warn(`graph "${env.graph.name}": flow reached unknown node "${currentNodeId}"`);
      return;
    }

    if (node.type === "core:repeat") {
      const { outputs } = runImpureNode(env, node, currentInputs, impureOutputs, loop);
      const count = typeof outputs.count === "number" ? outputs.count : 0;
      const bodyEdge = env.graph.outgoingFlow.get(socketKey(node.id, "flow"));
      if (bodyEdge) {
        for (let i = 0; i < count; i++) walkFlow(env, bodyEdge.target, {}, impureOutputs, loop, depth + 1);
      }
      return;
    }

    if (node.type === "core:forEachEntity") {
      const { outputs } = runImpureNode(env, node, currentInputs, impureOutputs, loop);
      const entities = Array.isArray(outputs.entities) ? outputs.entities : [];
      const bodyEdge = env.graph.outgoingFlow.get(socketKey(node.id, "flow"));
      if (bodyEdge) {
        for (const entity of entities) {
          walkFlow(env, bodyEdge.target, {}, impureOutputs, { nodeId: node.id, socketName: "entity", value: entity }, depth + 1);
        }
      }
      return;
    }

    const { nextFlowOutput } = runImpureNode(env, node, currentInputs, impureOutputs, loop);
    if (!nextFlowOutput) return;
    const edge = env.graph.outgoingFlow.get(socketKey(currentNodeId, nextFlowOutput));
    if (!edge) return;
    currentNodeId = edge.target;
    currentInputs = {};
  }
}

/**
 * Wires every trigger node (`compileGraph`'s own `triggerNodeIds`) in
 * `graph` to a real `events.on` subscription — the interpreter, not any
 * node's own `execute()`, is what actually calls `events.on` (see
 * `core:onEvent`'s doc comment in `@forge/graph-nodes-core`). A fresh
 * `impureOutputs` map is created per firing — each external event
 * activation starts with a clean slate of "nothing has run yet in this
 * pass". Returns the unsubscribe functions, for a caller that wants them;
 * `@forge/graph-runtime`'s own `setup()` doesn't need to unsubscribe
 * today (no `teardown()` is declared), but callers/tests are free to.
 */
export function attachGraph(
  graph: CompiledGraph,
  world: WorldApi,
  events: EventBus,
  dataTables: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>,
  warn: GraphWarn,
): Array<() => void> {
  const env: Env = { graph, world, events, dataTables, warn };
  const unsubscribes: Array<() => void> = [];
  for (const nodeId of graph.triggerNodeIds) {
    const node = graph.nodes.get(nodeId);
    if (!node) continue;
    const eventName = typeof node.config.event === "string" ? node.config.event : undefined;
    if (!eventName) {
      warn(`graph "${graph.name}", node "${nodeId}" (${node.type}): config.event is not a string — this trigger will never fire`);
      continue;
    }
    const unsubscribe = events.on(eventName, (payload) => {
      try {
        walkFlow(env, nodeId, { payload }, new Map(), undefined, 0);
      } catch (err) {
        warn(`graph "${graph.name}": uncaught error interpreting from node "${nodeId}"`, { message: err instanceof Error ? err.message : String(err) });
      }
    });
    unsubscribes.push(unsubscribe);
  }
  return unsubscribes;
}
