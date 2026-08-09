/**
 * Typed pub/sub, per docs/SPEC.md Section 9.3 — the primary inter-module
 * communication channel. `EventMap` is supplied by the caller (core events,
 * or a module's own namespaced events) so `on`/`emit` are checked at the
 * call site.
 */
export interface EventBus<EventMap extends Record<string, unknown> = Record<string, unknown>> {
  /** Returns an unsubscribe function. */
  on<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): () => void;
  off<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): void;
  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void;
}

type Handler = (payload: unknown) => void;

/**
 * `emit` must be safe to call from inside the fixed-step loop without
 * allocating: no new array is built on the common path. Removing a handler
 * tombstones its slot instead of splicing, and the backing array is
 * compacted only occasionally (when dead slots pile up), not on every call.
 */
export class EventBusImpl<EventMap extends Record<string, unknown> = Record<string, unknown>>
  implements EventBus<EventMap>
{
  private readonly handlers = new Map<keyof EventMap, Array<Handler | undefined>>();
  private readonly liveCounts = new Map<keyof EventMap, number>();

  on<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): () => void {
    let list = this.handlers.get(event);
    if (!list) {
      list = [];
      this.handlers.set(event, list);
    }
    list.push(handler as Handler);
    this.liveCounts.set(event, (this.liveCounts.get(event) ?? 0) + 1);
    return () => this.off(event, handler);
  }

  off<K extends keyof EventMap>(event: K, handler: (payload: EventMap[K]) => void): void {
    const list = this.handlers.get(event);
    if (!list) return;
    const index = list.indexOf(handler as Handler);
    if (index === -1) return;
    list[index] = undefined;
    this.liveCounts.set(event, (this.liveCounts.get(event) ?? 1) - 1);
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const list = this.handlers.get(event);
    if (!list || list.length === 0) return;

    const length = list.length;
    for (let i = 0; i < length; i++) {
      const handler = list[i];
      if (handler) handler(payload);
    }

    this.compactIfWorthwhile(event, list);
  }

  private compactIfWorthwhile(event: keyof EventMap, list: Array<Handler | undefined>): void {
    const live = this.liveCounts.get(event) ?? 0;
    const dead = list.length - live;
    if (list.length <= 8 || dead <= list.length / 2) return;
    const compacted = list.filter((h): h is Handler => h !== undefined);
    this.handlers.set(event, compacted);
  }
}
