/**
 * @forge/graph-nodes-core — the bounded set of node types every graph can
 * use with no module installed (docs/adr/0017's "task split": M2). Built
 * against `@forge/module-api` only, the same rule
 * `tools/security/check-module-boundaries.mjs` already enforces for every
 * other package under `packages/modules/`.
 *
 * `GraphNodeDefinition` itself (and its `GraphSocketType`/
 * `GraphSocketDefinition`/`GraphNodeExecutionContext` companions) lived
 * here provisionally at M2, then moved to its permanent home in
 * `@forge/module-api` at M4 once M3's editor had also exercised the shape
 * (docs/adr/0017 Decision 4's own task split) — import those types from
 * `@forge/module-api` directly, not from here. This package does not
 * itself call `defineGraphNode`: it exports plain `GraphNodeDefinition`
 * values, and whichever module registers them (M5's `@forge/graph-runtime`)
 * is what actually makes them available to a graph.
 */
export { createEntityNode, destroyEntityNode } from "./nodes/entity";
export { getComponentNode, hasComponentNode, setComponentNode } from "./nodes/component";
export { onEventNode, emitEventNode } from "./nodes/events";
export { equalsNode, greaterThanNode, lessThanNode, andNode, orNode, notNode } from "./nodes/comparisons";
export { addNode, subtractNode, multiplyNode, divideNode } from "./nodes/math";
export { branchNode, repeatNode, forEachEntityNode, DEFAULT_REPEAT_CEILING, ABSOLUTE_REPEAT_CEILING } from "./nodes/flow";
export { constantNode, getFieldNode, setFieldNode } from "./nodes/data";
export { questStartNode, questCompleteObjectiveNode, questIsActiveNode, questIsObjectiveCompleteNode } from "./nodes/quests";
export { lookupRowNode, tableRowCountNode } from "./nodes/dataTables";

import { createEntityNode, destroyEntityNode } from "./nodes/entity";
import { getComponentNode, hasComponentNode, setComponentNode } from "./nodes/component";
import { onEventNode, emitEventNode } from "./nodes/events";
import { equalsNode, greaterThanNode, lessThanNode, andNode, orNode, notNode } from "./nodes/comparisons";
import { addNode, subtractNode, multiplyNode, divideNode } from "./nodes/math";
import { branchNode, repeatNode, forEachEntityNode } from "./nodes/flow";
import { constantNode, getFieldNode, setFieldNode } from "./nodes/data";
import { questStartNode, questCompleteObjectiveNode, questIsActiveNode, questIsObjectiveCompleteNode } from "./nodes/quests";
import { lookupRowNode, tableRowCountNode } from "./nodes/dataTables";
import type { GraphNodeDefinition } from "@forge/module-api";

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
  constantNode,
  getFieldNode,
  setFieldNode,
  questStartNode,
  questCompleteObjectiveNode,
  questIsActiveNode,
  questIsObjectiveCompleteNode,
  lookupRowNode,
  tableRowCountNode,
];
