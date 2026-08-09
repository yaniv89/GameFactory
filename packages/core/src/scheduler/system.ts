import type { Query } from "../ecs/query";
import type { Phase } from "./phase";
import type { TickContext } from "./tickContext";

/**
 * Per docs/SPEC.md Section 8.3 / 9.3: ordering within a phase is resolved
 * from declared `before`/`after` dependencies, never from registration
 * order. Registration-order dependence is a plugin ecosystem's worst
 * failure mode because behavior would change based on install order.
 */
export interface SystemDefinition {
  readonly id: string;
  readonly phase: Phase;
  readonly query: readonly string[];
  readonly before?: readonly string[];
  readonly after?: readonly string[];
  /** Skip this system's run() when the query yields no entities. Default true. */
  readonly skipIfEmpty?: boolean;
  run(ctx: TickContext, entities: Query): void;
}

/**
 * Deterministic topological sort of the systems registered for one phase,
 * honoring `before`/`after` edges. Ties (no ordering constraint between two
 * systems) break by `id`, so the order is stable across runs regardless of
 * registration order — the property Section 8.3 requires.
 *
 * Throws if the constraints form a cycle: per Section 8.3, "cycles are a
 * hard build error," not a runtime fallback to registration order.
 */
export function resolveSystemOrder(systems: readonly SystemDefinition[]): SystemDefinition[] {
  const byId = new Map<string, SystemDefinition>();
  for (const system of systems) {
    if (byId.has(system.id)) {
      throw new Error(`Scheduler: duplicate system id "${system.id}" registered in phase "${system.phase}"`);
    }
    byId.set(system.id, system);
  }

  // edges[a] contains b means "a must run before b"
  const edges = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  for (const system of systems) {
    edges.set(system.id, edges.get(system.id) ?? new Set());
    inDegree.set(system.id, inDegree.get(system.id) ?? 0);
  }

  const addEdge = (fromId: string, toId: string) => {
    if (!byId.has(fromId) || !byId.has(toId)) return; // dependency outside this phase's system set is not our concern here
    const set = edges.get(fromId)!;
    if (set.has(toId)) return;
    set.add(toId);
    inDegree.set(toId, (inDegree.get(toId) ?? 0) + 1);
  };

  for (const system of systems) {
    for (const beforeId of system.before ?? []) addEdge(system.id, beforeId);
    for (const afterId of system.after ?? []) addEdge(afterId, system.id);
  }

  // Kahn's algorithm, with a deterministic tie-break by id so unconstrained
  // systems still produce a stable order run to run.
  const ready: string[] = [];
  for (const [id, degree] of inDegree) if (degree === 0) ready.push(id);
  ready.sort();

  const ordered: SystemDefinition[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(byId.get(id)!);
    const nextIds: string[] = [];
    for (const nextId of edges.get(id) ?? []) {
      const remaining = inDegree.get(nextId)! - 1;
      inDegree.set(nextId, remaining);
      if (remaining === 0) nextIds.push(nextId);
    }
    nextIds.sort();
    // Merge-insert to keep `ready` sorted without re-sorting the whole array each time.
    for (const nextId of nextIds) {
      const insertAt = ready.findIndex((existing) => existing > nextId);
      if (insertAt === -1) ready.push(nextId);
      else ready.splice(insertAt, 0, nextId);
    }
  }

  if (ordered.length !== systems.length) {
    const stuck = systems.map((s) => s.id).filter((id) => !ordered.some((o) => o.id === id));
    throw new Error(
      `Scheduler: cycle detected among systems in phase "${systems[0]?.phase}": ${stuck.join(", ")}. ` +
        `Check before/after declarations for a loop.`,
    );
  }

  return ordered;
}
