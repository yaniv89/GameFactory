import type { QuickJSContext, QuickJSHandle, QuickJSRuntime } from "quickjs-emscripten";

/**
 * One QuickJS runtime + context for exactly one module instance, per
 * docs/security/SANDBOX-DESIGN.md Section 3: "one QuickJSRuntime per
 * module instance, never shared across modules or across untrusted
 * sources." A `QuickJSRuntime` is the WASM-heap-level isolation
 * boundary; two modules must never share one, even if sharing a context
 * within it would otherwise be convenient.
 *
 * The `import type` above is erased at compile time and costs nothing at
 * runtime. The *value* import of `quickjs-emscripten` (`getQuickJS`) is
 * dynamic, inside `create()` only, so that importing this file doesn't
 * pull the ~228 KB WASM payload into any bundle that never actually
 * instantiates a module — see docs/adr/0004.
 */
export interface ModuleRuntimeOptions {
  /** Max WASM heap this module's runtime may allocate, in bytes. */
  memoryLimitBytes: number;
  /** Max native stack size, in bytes. */
  maxStackSizeBytes: number;
  /** Max wall-clock time a single `eval()` call may run before being interrupted, in ms. */
  computeBudgetMs: number;
}

export interface EvalSuccess {
  readonly ok: true;
  readonly value: unknown;
}

export interface EvalFailure {
  readonly ok: false;
  readonly error: {
    readonly name: string;
    readonly message: string;
  };
}

export type EvalOutcome = EvalSuccess | EvalFailure;

export class ModuleRuntime {
  private runtime: QuickJSRuntime | undefined;
  private context: QuickJSContext | undefined;
  private readonly computeBudgetMs: number;
  private disposed = false;

  private constructor(runtime: QuickJSRuntime, context: QuickJSContext, computeBudgetMs: number) {
    this.runtime = runtime;
    this.context = context;
    this.computeBudgetMs = computeBudgetMs;
  }

  static async create(options: ModuleRuntimeOptions): Promise<ModuleRuntime> {
    const { getQuickJS } = await import("quickjs-emscripten");
    const QuickJS = await getQuickJS();
    const runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(options.memoryLimitBytes);
    runtime.setMaxStackSize(options.maxStackSizeBytes);
    const context = runtime.newContext();
    return new ModuleRuntime(runtime, context, options.computeBudgetMs);
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Evaluates `code` with a fresh compute-budget deadline for this call —
   * per docs/security/SANDBOX-DESIGN.md Section 5, the interrupt handler
   * is re-armed on every call rather than set once, so each call gets its
   * own budget rather than sharing a stale one.
   */
  eval(code: string): EvalOutcome {
    if (this.disposed) {
      throw new Error("ModuleRuntime: cannot eval() after dispose()");
    }
    const runtime = this.runtime!;
    const context = this.context!;
    const deadline = Date.now() + this.computeBudgetMs;
    runtime.setInterruptHandler(() => Date.now() > deadline);

    try {
      const result = context.evalCode(code);
      if (result.error) {
        const dumped = context.dump(result.error) as { name?: unknown; message?: unknown } | undefined;
        result.error.dispose();
        return {
          ok: false,
          error: {
            name: typeof dumped?.name === "string" ? dumped.name : "Error",
            message: typeof dumped?.message === "string" ? dumped.message : String(dumped),
          },
        };
      }

      const value = context.dump(result.value as QuickJSHandle);
      result.value!.dispose();
      return { ok: true, value };
    } catch (err) {
      // A host-level exception here (observed in practice: deep guest
      // recursion overflowing the *host's* native call stack inside the
      // WASM interpreter, a RangeError that never reaches evalCode()'s own
      // { error } result path) means this VM's internal state is no
      // longer trustworthy. Fail safe: tear the whole runtime down rather
      // than risk continuing to evaluate code against a WASM instance
      // that may be left inconsistent. The caller must create a fresh
      // ModuleRuntime — this instance is dead from here on.
      this.dispose();
      return {
        ok: false,
        error: {
          name: err instanceof Error ? err.name : "Error",
          message: `sandbox runtime failed and was torn down: ${err instanceof Error ? err.message : String(err)}`,
        },
      };
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Must never throw, including when called after a host-level
    // exception left the underlying WASM instance in an unknown state
    // (see the catch block in eval()) — disposal is cleanup, not a place
    // to propagate a second failure on top of the first. Logged (not
    // silently swallowed, CLAUDE.md guardrail 11) since a dispose()
    // failure is exactly the kind of thing worth knowing about even
    // though this method can't propagate it further.
    try {
      this.context?.dispose();
    } catch (err) {
      console.error("ModuleRuntime.dispose(): context.dispose() failed, continuing cleanup", err);
    }
    try {
      this.runtime?.dispose();
    } catch (err) {
      console.error("ModuleRuntime.dispose(): runtime.dispose() failed, continuing cleanup", err);
    }
    this.context = undefined;
    this.runtime = undefined;
  }
}
