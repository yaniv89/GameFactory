import type { GraphSocketDefinition, GraphSocketType } from "@forge/module-api";
import { NODE_REGISTRY } from "./nodeRegistry";

/** Structurally the same shape as `GraphNodeInstance`/`GraphEdgeInstance` (`@forge/project-export`), but this module only needs `id`/`type` and `source`/`sourceHandle`/`target`/`targetHandle` — kept minimal and dependency-free so it's trivially unit-testable without pulling in the whole document type. */
export interface GraphValidationNode {
  readonly id: string;
  readonly type: string;
}

export interface GraphValidationEdge {
  readonly source: string;
  readonly sourceHandle: string;
  readonly target: string;
  readonly targetHandle: string;
}

export interface ConnectionCandidate {
  readonly source: string;
  readonly sourceHandle: string;
  readonly target: string;
  readonly targetHandle: string;
}

export type ConnectionValidationResult = { readonly valid: true } | { readonly valid: false; readonly reason: string };

function findSocket(nodeType: string, direction: "inputs" | "outputs", handleName: string): GraphSocketDefinition | undefined {
  return NODE_REGISTRY[nodeType]?.definition[direction].find((socket) => socket.name === handleName);
}

function socketsCompatible(a: GraphSocketType, b: GraphSocketType): boolean {
  if (a === "flow" || b === "flow") return a === b; // flow never mixes with a data type
  return a === "any" || b === "any" || a === b;
}

/**
 * True if adding `candidate` would create a cycle in the graph — checked
 * by asking whether `candidate.target` can already reach `candidate.source`
 * through existing edges (a path back would close the loop). Applies
 * uniformly to flow and data edges alike: docs/adr/0017 Decision 3 forbids
 * any wired cycle in v1 (no graph-calls-graph, no recursion), not just a
 * flow-only one — the bounded-iteration nodes are the only sanctioned
 * "loop", and they don't need a backward wire to express it.
 */
function wouldCreateCycle(edges: readonly GraphValidationEdge[], candidate: ConnectionCandidate): boolean {
  if (candidate.source === candidate.target) return true;
  const visited = new Set<string>([candidate.target]);
  const stack = [candidate.target];
  while (stack.length > 0) {
    const nodeId = stack.pop()!;
    for (const edge of edges) {
      if (edge.source !== nodeId) continue;
      if (edge.target === candidate.source) return true;
      if (!visited.has(edge.target)) {
        visited.add(edge.target);
        stack.push(edge.target);
      }
    }
  }
  return false;
}

/**
 * docs/adr/0017 Decision 5: "type-mismatched sockets refuse to connect...
 * a cyclic data-flow graph is rejected at wire-time" — the editor-side
 * half of that discipline (M5's compile step re-validates from scratch
 * regardless; this is what keeps a well-behaved editor session from ever
 * producing a bad document in the first place, per CLAUDE.md 5.3's
 * "canvas never blocks" combined with catching a mistake before it's
 * saved, not after).
 */
export function isValidConnection(
  nodes: readonly GraphValidationNode[],
  edges: readonly GraphValidationEdge[],
  candidate: ConnectionCandidate,
): ConnectionValidationResult {
  const sourceNode = nodes.find((node) => node.id === candidate.source);
  const targetNode = nodes.find((node) => node.id === candidate.target);
  if (!sourceNode || !targetNode) return { valid: false, reason: "One of the connected nodes no longer exists." };

  const sourceSocket = findSocket(sourceNode.type, "outputs", candidate.sourceHandle);
  const targetSocket = findSocket(targetNode.type, "inputs", candidate.targetHandle);
  if (!sourceSocket) return { valid: false, reason: `"${sourceNode.type}" has no output socket named "${candidate.sourceHandle}".` };
  if (!targetSocket) return { valid: false, reason: `"${targetNode.type}" has no input socket named "${candidate.targetHandle}".` };

  if (!socketsCompatible(sourceSocket.type, targetSocket.type)) {
    return { valid: false, reason: `Socket types don't match: "${sourceSocket.type}" can't connect to "${targetSocket.type}".` };
  }

  if (targetSocket.type !== "flow") {
    const alreadyWired = edges.some((edge) => edge.target === candidate.target && edge.targetHandle === candidate.targetHandle);
    if (alreadyWired) return { valid: false, reason: "That input already has a value wired in — disconnect it first." };
  } else {
    const alreadyWired = edges.some((edge) => edge.source === candidate.source && edge.sourceHandle === candidate.sourceHandle);
    if (alreadyWired) return { valid: false, reason: "That flow output already continues somewhere else — disconnect it first." };
  }

  if (wouldCreateCycle(edges, candidate)) {
    return { valid: false, reason: "That connection would create a cycle — v1 graphs can't loop back on themselves (docs/adr/0017 Decision 3)." };
  }

  return { valid: true };
}
