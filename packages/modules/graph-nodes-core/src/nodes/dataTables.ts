import type { GraphNodeDefinition } from "@forge/module-api";

/**
 * docs/adr/0018 Decision 3: a data table is read directly off
 * `GraphNodeExecutionContext.dataTables` (`@forge/module-api`'s `graph.ts`,
 * M11) — no event round-trip needed, unlike `core:questIsActive`'s
 * `quest:query`/`quest:queried` pattern (`nodes/quests.ts`'s own doc
 * comment): a data table is read-only project data delivered straight
 * into the context the same way `world`/`events` already are, not a live
 * module's mutable runtime state something else owns. Both nodes here are
 * pure — a table lookup has no side effect, matching `core:getComponent`'s
 * own "pure = no flow socket" reasoning.
 *
 * `table`/`keyColumn` are `config` values (picked once at authoring time
 * from the project's own authored table/column ids, M12's own
 * `DataTablesPanel`), the same treatment `core:getComponent`'s `component`
 * name already gets. A missing/unknown table degrades gracefully — empty
 * result plus `ctx.warn` — rather than throwing, matching every other
 * pure node here on a partially-wired or not-yet-authored graph.
 */
export const lookupRowNode: GraphNodeDefinition = {
  type: "core:lookupRow",
  inputs: [{ name: "key", type: "any" }],
  outputs: [{ name: "row", type: "any" }],
  execute(ctx, inputs, config) {
    const tableId = config.table as string;
    const keyColumn = config.keyColumn as string;
    const rows = ctx.dataTables[tableId];
    if (!rows) {
      ctx.warn(`core:lookupRow: no data table "${tableId}" — is it authored, and does the id match?`, { tableId });
      return { row: null };
    }
    const row = rows.find((candidate) => candidate[keyColumn] === inputs.key);
    return { row: row ?? null };
  },
};

export const tableRowCountNode: GraphNodeDefinition = {
  type: "core:tableRowCount",
  inputs: [],
  outputs: [{ name: "count", type: "number" }],
  execute(ctx, _inputs, config) {
    const tableId = config.table as string;
    const rows = ctx.dataTables[tableId];
    if (!rows) {
      ctx.warn(`core:tableRowCount: no data table "${tableId}" — is it authored, and does the id match?`, { tableId });
      return { count: 0 };
    }
    return { count: rows.length };
  },
};
