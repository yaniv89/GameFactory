import { coreGraphNodes } from "@forge/graph-nodes-core";
import type { ForgeModule, GraphNodeDefinition, SetupContext, TeardownContext } from "@forge/module-api";
import { compileGraph, type CompiledGraph } from "./compileGraph";
import { attachGraph } from "./interpreter";
import type { GraphDocumentData, GraphRuntimeConfig } from "./types";

export * from "./compileGraph";
export * from "./interpreter";
export * from "./types";

function validateGraphDocuments(ctx: SetupContext): readonly GraphDocumentData[] {
  const raw = (ctx.config as GraphRuntimeConfig).graphs;
  if (!Array.isArray(raw)) return [];
  const valid: GraphDocumentData[] = [];
  for (const doc of raw) {
    if (typeof doc?.id !== "string" || typeof doc?.name !== "string" || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) {
      ctx.log.warn("graph-runtime: skipping a malformed entry in config.graphs (needs a string id/name and nodes/edges arrays)", { doc });
      continue;
    }
    valid.push(doc as GraphDocumentData);
  }
  return valid;
}

/**
 * `@forge/graph-runtime` — docs/adr/0017's node-graph interpreter (M5),
 * built entirely against `@forge/module-api` and `@forge/graph-nodes-core`
 * (`tools/security/check-module-boundaries.mjs`'s one narrow, explicitly
 * justified exception — see that script's own comment). Receives every
 * compiled graph document for the project as `config.graphs`
 * (`packages/project-export/src/moduleAdapters.ts`'s own export-time
 * adapter assembles this from `ProjectDocument.graphs`, the same way
 * `@forge/dialogue` already receives `config.trees`), re-validates each
 * one from scratch (`compileGraph.ts`, docs/adr/0017 Decision 5 — never
 * trusts that the editor already validated it), and wires every trigger
 * node to a real `ctx.events.on` subscription (`interpreter.ts`).
 *
 * Scope, stated honestly: interprets graphs built from the core node
 * library (`@forge/graph-nodes-core`) only. A graph node wired to a
 * third-party-registered type (docs/adr/0017 Decision 4's own extension
 * point, formalized at M4) fails `compileGraph`'s "unknown node type"
 * check — M4 proved *registration* of a third-party node type works
 * end to end through the real sandbox, not *invocation*; there is still
 * no established wire protocol for a cross-module `GraphNodeExecutionContext`
 * call, and this module doesn't invent one speculatively. Also: this
 * module never calls `ctx.addSystem` — every core trigger node
 * (`core:onEvent`) is event-driven, not per-tick, so there is no
 * per-frame graph work to schedule in v1. docs/adr/0017 Decision 6's own
 * per-graph performance attribution is consequently **not implemented**
 * here either: it isn't needed yet (nothing runs every tick), and the
 * "no new mechanism — reuses Section 18's existing per-module cost
 * tracking" premise the ADR stated for it doesn't actually hold on
 * inspection (`InterceptorRegistry` has real per-point timing;
 * `Scheduler.runPhase` has none for systems) — worth a real follow-up
 * task, not silently claimed as done here.
 *
 * `teardown()` (M6): the editor's live preview rebuilds this module fresh
 * on every edited scene message, the same "no way to hand it updated
 * content short of a fresh `setup()` call" treatment `@forge/dialogue`
 * already gets (`PreviewApp.tsx`'s own doc comment) — but unlike
 * dialogue, graph-runtime deliberately shares the *same* persistent
 * `world`/`events` across rebuilds (it has to: its nodes mutate real game
 * entities, not a disposable per-module sandbox one). Without an explicit
 * teardown, every rebuild would stack a fresh set of `events.on(...)`
 * subscriptions from `attachGraph` on top of the previous ones, on the
 * same long-lived bus — the module-scoped `activeUnsubscribes` here is
 * what keeps that from happening. `ModuleBridge.teardown()`
 * (`packages/runtime-host`, already real since before this module
 * existed) calls this the identical way in the sandboxed path, so this
 * isn't a preview-only accommodation.
 */
let activeUnsubscribes: Array<() => void> = [];

export const graphRuntimeModule: ForgeModule = {
  setup(ctx: SetupContext): void {
    const nodeTypes = new Map<string, GraphNodeDefinition>(coreGraphNodes.map((node) => [node.type, node]));
    for (const node of coreGraphNodes) ctx.defineGraphNode(node);

    const documents = validateGraphDocuments(ctx);
    const compiled: CompiledGraph[] = [];
    for (const doc of documents) {
      const graph = compileGraph(doc, nodeTypes, (message) => ctx.log.warn(`graph-runtime: ${message}`));
      if (graph) compiled.push(graph);
    }

    activeUnsubscribes = [];
    for (const graph of compiled) {
      const unsubscribes = attachGraph(graph, ctx.world, ctx.events, ctx.dataTables, (message, data) => ctx.log.warn(`graph-runtime: ${message}`, data));
      activeUnsubscribes.push(...unsubscribes);
    }
  },
  teardown(_ctx: TeardownContext): void {
    for (const unsubscribe of activeUnsubscribes) unsubscribe();
    activeUnsubscribes = [];
  },
};

export default graphRuntimeModule;
