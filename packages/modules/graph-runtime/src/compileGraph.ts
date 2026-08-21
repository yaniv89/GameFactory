import type { GraphNodeDefinition, GraphSocketDefinition, GraphSocketType } from "@forge/module-api";
import type { GraphDocumentData, GraphEdgeInstanceData, GraphNodeInstanceData } from "./types";

export interface CompiledNode {
  readonly id: string;
  readonly type: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly definition: GraphNodeDefinition;
}

export interface CompiledGraph {
  readonly id: string;
  readonly name: string;
  readonly nodes: ReadonlyMap<string, CompiledNode>;
  /** `${nodeId}:${socketName}` for a flow OUTPUT socket -> the one edge continuing from it (fan-out of at most 1, enforced below). */
  readonly outgoingFlow: ReadonlyMap<string, GraphEdgeInstanceData>;
  /** `${nodeId}:${socketName}` for a data INPUT socket -> the one edge feeding it (fan-in of at most 1, enforced below). */
  readonly incomingData: ReadonlyMap<string, GraphEdgeInstanceData>;
  /** Impure nodes with a flow output but no flow input at all — a graph's entry points (`core:onEvent` today; any future trigger-shaped node works the same way, nothing hardcodes the type name). */
  readonly triggerNodeIds: readonly string[];
}

function socketKey(nodeId: string, socketName: string): string {
  return `${nodeId}:${socketName}`;
}

function findSocket(sockets: readonly GraphSocketDefinition[], name: string): GraphSocketDefinition | undefined {
  return sockets.find((socket) => socket.name === name);
}

function socketsCompatible(a: GraphSocketType, b: GraphSocketType): boolean {
  if (a === "flow" || b === "flow") return a === b;
  return a === "any" || b === "any" || a === b;
}

/** True if adding `edge` on top of `existingEdges` would close a cycle — same "does the target already reach the source" check the editor's own `graphValidation.ts` uses (independently implemented here per docs/adr/0017 Decision 5: the runtime never trusts that the editor already validated this). */
function wouldCreateCycle(existingEdges: readonly GraphEdgeInstanceData[], edge: GraphEdgeInstanceData): boolean {
  if (edge.source === edge.target) return true;
  const visited = new Set<string>([edge.target]);
  const stack = [edge.target];
  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    for (const candidate of existingEdges) {
      if (candidate.source !== nodeId) continue;
      if (candidate.target === edge.source) return true;
      if (!visited.has(candidate.target)) {
        visited.add(candidate.target);
        stack.push(candidate.target);
      }
    }
  }
  return false;
}

/**
 * Re-validates a graph document from scratch — docs/adr/0017 Decision 5:
 * "nothing the server or the runtime receives is trusted because a
 * well-behaved client produced it." A malformed graph is skipped
 * entirely (returns `undefined`, having called `warn` with why) rather
 * than partially interpreted — the same "one bad input isn't a verdict
 * on the whole batch" treatment `@forge/dialogue`'s `validateTrees` and
 * `Forge.Functions.ArtGen`'s variation batching (N3) already use, applied
 * here at the whole-graph granularity: one bad graph doesn't take down
 * the others in the same project.
 */
export function compileGraph(
  doc: GraphDocumentData,
  nodeTypes: ReadonlyMap<string, GraphNodeDefinition>,
  warn: (message: string) => void,
): CompiledGraph | undefined {
  const fail = (reason: string): undefined => {
    warn(`graph "${doc.name}" (${doc.id}) is invalid, skipping it: ${reason}`);
    return undefined;
  };

  const nodes = new Map<string, CompiledNode>();
  for (const node of doc.nodes) {
    if (nodes.has(node.id)) return fail(`duplicate node id "${node.id}"`);
    const definition = nodeTypes.get(node.type);
    if (!definition) return fail(`node "${node.id}" references unknown node type "${node.type}"`);
    nodes.set(node.id, { id: node.id, type: node.type, config: node.config, definition });
  }

  const outgoingFlow = new Map<string, GraphEdgeInstanceData>();
  const incomingData = new Map<string, GraphEdgeInstanceData>();
  const acceptedEdges: GraphEdgeInstanceData[] = [];

  for (const edge of doc.edges) {
    const sourceNode = nodes.get(edge.source);
    const targetNode = nodes.get(edge.target);
    if (!sourceNode) return fail(`edge "${edge.id}" references unknown source node "${edge.source}"`);
    if (!targetNode) return fail(`edge "${edge.id}" references unknown target node "${edge.target}"`);

    const sourceSocket = findSocket(sourceNode.definition.outputs, edge.sourceHandle);
    const targetSocket = findSocket(targetNode.definition.inputs, edge.targetHandle);
    if (!sourceSocket) return fail(`edge "${edge.id}": node type "${sourceNode.type}" has no output socket "${edge.sourceHandle}"`);
    if (!targetSocket) return fail(`edge "${edge.id}": node type "${targetNode.type}" has no input socket "${edge.targetHandle}"`);
    if (!socketsCompatible(sourceSocket.type, targetSocket.type)) {
      return fail(`edge "${edge.id}": socket types don't match ("${sourceSocket.type}" -> "${targetSocket.type}")`);
    }

    if (wouldCreateCycle(acceptedEdges, edge)) return fail(`edge "${edge.id}" would create a cycle — v1 graphs can't loop back on themselves`);

    if (targetSocket.type === "flow") {
      const key = socketKey(edge.source, edge.sourceHandle);
      if (outgoingFlow.has(key)) return fail(`node "${edge.source}"'s flow output "${edge.sourceHandle}" already has an outgoing edge — a flow output can only continue one way`);
      outgoingFlow.set(key, edge);
    } else {
      const key = socketKey(edge.target, edge.targetHandle);
      if (incomingData.has(key)) return fail(`node "${edge.target}"'s input "${edge.targetHandle}" already has an incoming edge — a data input can only be wired once`);
      incomingData.set(key, edge);
    }

    acceptedEdges.push(edge);
  }

  const triggerNodeIds = [...nodes.values()]
    .filter((node) => node.definition.outputs.some((s) => s.type === "flow") && !node.definition.inputs.some((s) => s.type === "flow"))
    .map((node) => node.id);

  return { id: doc.id, name: doc.name, nodes, outgoingFlow, incomingData, triggerNodeIds };
}
