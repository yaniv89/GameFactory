import type { EntityId, EventBus, GraphNodeExecutionContext, WorldApi } from "@forge/module-api";

/**
 * A minimal, faithful fake of `GraphNodeExecutionContext` — no QuickJS, no
 * `@forge/graph-runtime` interpreter. This exercises each node's own
 * `execute()` logic directly against the public contract, the same
 * "fake the context, not the bridge" shape
 * `packages/modules/dialogue/test/dialogue.test.ts` already established
 * for `SetupContext`.
 */
export function makeFakeWorld(initial: ReadonlyMap<EntityId, Record<string, unknown>> = new Map()): WorldApi {
  const data = new Map(initial);
  let nextId = 1000;
  return {
    create(components) {
      const id = nextId++;
      data.set(id, { ...(components ?? {}) });
      return id;
    },
    destroy(id) {
      data.delete(id);
    },
    has(id, component) {
      return component in (data.get(id) ?? {});
    },
    get(id, component) {
      return data.get(id)?.[component] as never;
    },
    set(id, component, value) {
      const entity = data.get(id);
      if (!entity) throw new Error(`fake world: set() on unknown entity ${id}`);
      entity[component] = { ...(entity[component] as Record<string, unknown> | undefined), ...(value as Record<string, unknown>) };
    },
    add(id, component, value) {
      const entity = data.get(id) ?? {};
      entity[component] = value;
      data.set(id, entity);
    },
    remove(id, component) {
      delete data.get(id)?.[component];
    },
    query(components) {
      const ids = [...data.entries()].filter(([, entity]) => components.every((c) => c in entity)).map(([id]) => id);
      return { count: ids.length, forEach: (fn) => ids.forEach(fn) };
    },
  };
}

export function makeFakeEvents(): EventBus & { emitted: Array<{ event: string; payload: unknown }> } {
  const handlers = new Map<string, Array<(payload: unknown) => void>>();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  return {
    emitted,
    on(event, handler) {
      const list = handlers.get(event as string) ?? [];
      list.push(handler as (payload: unknown) => void);
      handlers.set(event as string, list);
      return () => {
        const idx = list.indexOf(handler as (payload: unknown) => void);
        if (idx !== -1) list.splice(idx, 1);
      };
    },
    off(event, handler) {
      const list = handlers.get(event as string);
      if (!list) return;
      const idx = list.indexOf(handler as (payload: unknown) => void);
      if (idx !== -1) list.splice(idx, 1);
    },
    emit(event, payload) {
      emitted.push({ event: event as string, payload });
      for (const handler of handlers.get(event as string) ?? []) handler(payload);
    },
  };
}

export interface FakeExecutionContext extends GraphNodeExecutionContext {
  readonly nextCalls: string[];
  readonly warnings: Array<{ message: string; data?: Record<string, unknown> }>;
}

export function makeFakeContext(overrides?: {
  world?: WorldApi;
  events?: EventBus;
  dataTables?: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
}): FakeExecutionContext {
  const nextCalls: string[] = [];
  const warnings: Array<{ message: string; data?: Record<string, unknown> }> = [];
  return {
    world: overrides?.world ?? makeFakeWorld(),
    events: overrides?.events ?? makeFakeEvents(),
    dataTables: overrides?.dataTables ?? {},
    nextCalls,
    warnings,
    next(flowOutput) {
      nextCalls.push(flowOutput);
    },
    warn(message, data) {
      warnings.push(data === undefined ? { message } : { message, data });
    },
  };
}
