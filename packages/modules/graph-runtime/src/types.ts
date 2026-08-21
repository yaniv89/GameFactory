/**
 * The wire shape `ctx.config.graphs` arrives in — structurally identical
 * to `@forge/project-export`'s `GraphDocument`/`GraphNodeInstance`/
 * `GraphEdgeInstance`, independently declared here rather than imported:
 * this package may only depend on `@forge/module-api` and
 * `@forge/graph-nodes-core` (`tools/security/check-module-boundaries.mjs`),
 * the same "the public contract must stay stable even if the producing
 * package's internals change" reasoning `@forge/module-api`'s own types
 * already use relative to `@forge/core`.
 */
export interface GraphNodeInstanceData {
  readonly id: string;
  readonly type: string;
  readonly config: Readonly<Record<string, unknown>>;
}

export interface GraphEdgeInstanceData {
  readonly id: string;
  readonly source: string;
  readonly sourceHandle: string;
  readonly target: string;
  readonly targetHandle: string;
}

export interface GraphDocumentData {
  readonly id: string;
  readonly name: string;
  readonly nodes: readonly GraphNodeInstanceData[];
  readonly edges: readonly GraphEdgeInstanceData[];
}

/** `@forge/graph-runtime`'s own `SetupContext.config` shape — see `packages/project-export/src/moduleAdapters.ts`'s export-time adapter, which is what actually assembles this from `ProjectDocument.graphs`. */
export interface GraphRuntimeConfig {
  readonly graphs?: readonly GraphDocumentData[];
}
