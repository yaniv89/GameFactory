import { EventBusImpl, FIXED_STEP_MS, InterceptorRegistry, Scheduler } from "@forge/core";
import { ModuleBridge } from "../module/moduleBridge";
import { buildSmokeFixtureWorld } from "./fixtureWorld";

export interface SmokeRunOptions {
  readonly moduleName: string;
  readonly version: string;
  readonly engineVersion: string;
  readonly config?: Readonly<Record<string, unknown>>;
  readonly bundleSource: string;
  /** Presence grants the `network` capability against this allowlist — mirrors `ModuleBridgeOptions`, and should be sourced from the manifest's own declared+approved allowlist, never invented here. */
  readonly networkAllowedOrigins?: readonly string[];
  /** docs/SPEC.md Section 10.4 gate 4 default: 600. */
  readonly ticks?: number;
  readonly memoryLimitBytes?: number;
  readonly maxStackSizeBytes?: number;
  readonly computeBudgetMs?: number;
}

export type SmokeRunVerdict = "passed" | "blocked";

export interface SmokeRunReport {
  readonly verdict: SmokeRunVerdict;
  readonly ticksRequested: number;
  readonly ticksCompleted: number;
  /** True only for a host-level sandbox-runtime teardown (`ModuleBridge.isDisposed`), never for an ordinary guest-level thrown error. */
  readonly crashed: boolean;
  readonly error?: { readonly phase: "setup" | "run"; readonly name: string; readonly message: string };
  readonly budget: { readonly maxTickMs: number; readonly totalMs: number; readonly averageTickMs: number };
}

const DEFAULT_TICKS = 600; // docs/SPEC.md Section 10.4 gate 4.
const DEFAULT_MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_STACK_SIZE_BYTES = 1024 * 1024;
const DEFAULT_COMPUTE_BUDGET_MS = 500; // matches ModuleBridge's own test-harness default (packages/runtime-host/test/moduleBridge.test.ts).

const EMPTY_BUDGET = { maxTickMs: 0, totalMs: 0, averageTickMs: 0 } as const;

/**
 * docs/SPEC.md Section 10.4 gate 4: loads `options.bundleSource` into the
 * same real sandbox (`ModuleBridge` over `ModuleRuntime` — the QuickJS-in-
 * WASM boundary `docs/security/SANDBOX-DESIGN.md` documents, verified
 * against the same host process/environment `sandbox-escape.test.ts`
 * already proves it holds in), calls its `setup()`, then drives `ticks`
 * fixed-step ticks against a small representative fixture world
 * (`buildSmokeFixtureWorld`).
 *
 * "Crash" here means specifically a host-level sandbox-runtime teardown
 * (`ModuleBridge.isDisposed` — see its own doc comment). A per-tick guest
 * error that `ModuleBridge`'s own bridge code already catches and logs
 * (an interrupted infinite loop inside a system, an ordinary thrown
 * error) is *not* a crash by that definition — the interrupt handler
 * doing its job and bounding the tick's cost is exactly what "measure
 * budget" is for, not a block condition. A `setup()` that never
 * completes (throws, or is itself interrupted) is different: the module
 * cannot function at all, so that always blocks regardless of whether
 * the underlying runtime happened to survive it.
 *
 * This never claims a bundle is *safe* — only that it initializes and
 * ran `ticks` ticks without corrupting its own sandbox instance. The
 * actual security boundary is the sandbox itself; this is a smoke test
 * on top of it, per its name.
 */
export async function runModuleSmokeTest(options: SmokeRunOptions): Promise<SmokeRunReport> {
  const ticks = options.ticks ?? DEFAULT_TICKS;
  const world = buildSmokeFixtureWorld();
  const scheduler = new Scheduler(world);
  const events = new EventBusImpl();
  const interceptors = new InterceptorRegistry();

  const bridge = await ModuleBridge.create({
    moduleName: options.moduleName,
    version: options.version,
    engineVersion: options.engineVersion,
    config: options.config ?? {},
    world,
    scheduler,
    events,
    interceptors,
    memoryLimitBytes: options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES,
    maxStackSizeBytes: options.maxStackSizeBytes ?? DEFAULT_MAX_STACK_SIZE_BYTES,
    computeBudgetMs: options.computeBudgetMs ?? DEFAULT_COMPUTE_BUDGET_MS,
    ...(options.networkAllowedOrigins ? { networkAllowedOrigins: options.networkAllowedOrigins } : {}),
  });

  try {
    const setupOutcome = bridge.setup(options.bundleSource);
    if (!setupOutcome.ok) {
      return {
        verdict: "blocked",
        ticksRequested: ticks,
        ticksCompleted: 0,
        crashed: bridge.isDisposed,
        error: { phase: "setup", name: setupOutcome.error.name, message: setupOutcome.error.message },
        budget: EMPTY_BUDGET,
      };
    }

    let maxTickMs = 0;
    let totalMs = 0;
    let ticksCompleted = 0;
    for (let i = 0; i < ticks; i++) {
      const start = performance.now();
      scheduler.tick(FIXED_STEP_MS);
      const elapsed = performance.now() - start;
      totalMs += elapsed;
      if (elapsed > maxTickMs) maxTickMs = elapsed;
      ticksCompleted++;
      if (bridge.isDisposed) break; // A guest-level failure tore the sandbox runtime down mid-run (see ModuleRuntime.evaluateProtected's own doc comment).
    }

    const budget = { maxTickMs, totalMs, averageTickMs: ticksCompleted > 0 ? totalMs / ticksCompleted : 0 };
    if (bridge.isDisposed) {
      // The specific guest-side error is already logged by
      // ModuleBridge's own runGuestSystem (console.error) at the moment
      // it happened — it isn't threaded back through Scheduler.tick()'s
      // return value, so it can't be captured structurally here without
      // a bridge-level change beyond this gate's scope. What matters for
      // the verdict is already known: the sandbox instance is gone.
      return {
        verdict: "blocked",
        ticksRequested: ticks,
        ticksCompleted,
        crashed: true,
        error: { phase: "run", name: "SandboxCrashed", message: `Sandbox runtime was torn down during tick ${ticksCompleted} of ${ticks}; see host logs for the triggering guest-side error.` },
        budget,
      };
    }

    return { verdict: "passed", ticksRequested: ticks, ticksCompleted, crashed: false, budget };
  } finally {
    bridge.dispose(); // Idempotent — safe whether or not the runtime already tore itself down.
  }
}
