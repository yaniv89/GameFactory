/**
 * @forge/graph-nodes-core — the bounded set of node types every graph can
 * use with no module installed (docs/adr/0017's "task split": M2). Built
 * against `@forge/module-api` only, the same rule
 * `tools/security/check-module-boundaries.mjs` already enforces for every
 * other package under `packages/modules/`.
 *
 * This package does not itself register anything with `defineGraphNode` —
 * that call doesn't exist on `SetupContext` yet (it's formalized into
 * `@forge/module-api` at M4, per docs/adr/0017 Decision 4's own task
 * split). It exports plain `GraphNodeDefinition` values; whichever module
 * calls `defineGraphNode` for each of them (M4/M5's job) is what actually
 * makes them available to a graph.
 */
export * from "./types";

export { createEntityNode, destroyEntityNode } from "./nodes/entity";
export { getComponentNode, hasComponentNode, setComponentNode } from "./nodes/component";
export { onEventNode, emitEventNode } from "./nodes/events";
export { equalsNode, greaterThanNode, lessThanNode, andNode, orNode, notNode } from "./nodes/comparisons";
export { addNode, subtractNode, multiplyNode, divideNode } from "./nodes/math";
export { branchNode, repeatNode, forEachEntityNode, DEFAULT_REPEAT_CEILING, ABSOLUTE_REPEAT_CEILING } from "./nodes/flow";

import { createEntityNode, destroyEntityNode } from "./nodes/entity";
import { getComponentNode, hasComponentNode, setComponentNode } from "./nodes/component";
import { onEventNode, emitEventNode } from "./nodes/events";
import { equalsNode, greaterThanNode, lessThanNode, andNode, orNode, notNode } from "./nodes/comparisons";
import { addNode, subtractNode, multiplyNode, divideNode } from "./nodes/math";
import { branchNode, repeatNode, forEachEntityNode } from "./nodes/flow";
import type { GraphNodeDefinition } from "./types";

/** Every core node definition, for whatever registers them in bulk (M4/M5). */
export const coreGraphNodes: readonly GraphNodeDefinition[] = [
  createEntityNode,
  destroyEntityNode,
  getComponentNode,
  hasComponentNode,
  setComponentNode,
  onEventNode,
  emitEventNode,
  equalsNode,
  greaterThanNode,
  lessThanNode,
  andNode,
  orNode,
  notNode,
  addNode,
  subtractNode,
  multiplyNode,
  divideNode,
  branchNode,
  repeatNode,
  forEachEntityNode,
];
