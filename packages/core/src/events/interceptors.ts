import type { World } from "../ecs/world";

/** Per docs/SPEC.md Section 9.3/9.4. */
export interface InterceptorContext {
  readonly world: World;
}

type InterceptorFn<Value> = (value: Value, ctx: InterceptorContext) => Value;

interface InterceptorEntry<Value> {
  readonly priority: number;
  readonly seq: number;
  readonly fn: InterceptorFn<Value>;
  readonly moduleName: string;
}

interface InterceptorStats {
  readonly moduleName: string;
  callCount: number;
  totalMs: number;
  lastMs: number;
}

/**
 * The WordPress-filter mechanism from docs/SPEC.md Section 9.4: a Module
 * transforms a value in a priority-ordered chain without patching the
 * producer. Lower priority runs first; ties preserve registration order.
 *
 * Per 9.4's discipline note, execution time is tracked per interceptor so
 * the editor profiler can attribute a slow frame to the specific module
 * responsible — the timing capture lives here, in core; rendering it is an
 * editor concern (M4).
 */
export class InterceptorRegistry<InterceptorMap extends Record<string, unknown> = Record<string, unknown>> {
  private readonly chains = new Map<keyof InterceptorMap, Array<InterceptorEntry<unknown>>>();
  private readonly stats = new Map<string, InterceptorStats>();
  private seqCounter = 0;

  add<K extends keyof InterceptorMap>(
    point: K,
    priority: number,
    fn: InterceptorFn<InterceptorMap[K]>,
    moduleName = "core",
  ): void {
    let chain = this.chains.get(point);
    if (!chain) {
      chain = [];
      this.chains.set(point, chain);
    }
    chain.push({ priority, seq: this.seqCounter++, fn: fn as InterceptorFn<unknown>, moduleName });
    chain.sort((a, b) => a.priority - b.priority || a.seq - b.seq);

    const statsKey = `${String(point)}::${moduleName}`;
    if (!this.stats.has(statsKey)) {
      this.stats.set(statsKey, { moduleName, callCount: 0, totalMs: 0, lastMs: 0 });
    }
  }

  /** Runs the chain for `point`, feeding each interceptor's output into the next. Returns `value` unchanged if no interceptor is registered. */
  run<K extends keyof InterceptorMap>(point: K, value: InterceptorMap[K], ctx: InterceptorContext): InterceptorMap[K] {
    const chain = this.chains.get(point);
    if (!chain || chain.length === 0) return value;

    let acc = value;
    for (const entry of chain) {
      const start = now();
      acc = (entry.fn as InterceptorFn<InterceptorMap[K]>)(acc, ctx);
      const elapsed = now() - start;

      const statsKey = `${String(point)}::${entry.moduleName}`;
      const stat = this.stats.get(statsKey)!;
      stat.callCount++;
      stat.totalMs += elapsed;
      stat.lastMs = elapsed;
    }
    return acc;
  }

  /** Diagnostic snapshot for the editor profiler: per (point, module) call count and timing. */
  getStats(): ReadonlyMap<string, Readonly<InterceptorStats>> {
    return this.stats;
  }
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
