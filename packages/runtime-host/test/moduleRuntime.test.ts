import { describe, expect, it } from "vitest";
import { ModuleRuntime } from "../src/sandbox/moduleRuntime";
import { buildWasmModuleFromEmbeddedBytes } from "./testWasmModule";

const BASE_OPTIONS = {
  memoryLimitBytes: 4 * 1024 * 1024,
  maxStackSizeBytes: 1024 * 1024,
  computeBudgetMs: 500,
};

describe("ModuleRuntime.create with a caller-supplied wasmModule", () => {
  it("evaluates real guest code using a module built from embedded WASM bytes, not getQuickJS()'s network/XHR path", async () => {
    const wasmModule = await buildWasmModuleFromEmbeddedBytes();
    const runtime = await ModuleRuntime.create({ ...BASE_OPTIONS, wasmModule });

    const result = runtime.eval("1 + 2");

    expect(result).toEqual({ ok: true, value: 3 });
    runtime.dispose();
  });

  it("two runtimes built from the same wasmModule stay isolated from each other, same as the default getQuickJS() path", async () => {
    const wasmModule = await buildWasmModuleFromEmbeddedBytes();
    const runtimeA = await ModuleRuntime.create({ ...BASE_OPTIONS, wasmModule });
    const runtimeB = await ModuleRuntime.create({ ...BASE_OPTIONS, wasmModule });

    runtimeA.eval("globalThis.x = 'a'");
    runtimeB.eval("globalThis.x = 'b'");

    expect(runtimeA.eval("globalThis.x")).toEqual({ ok: true, value: "a" });
    expect(runtimeB.eval("globalThis.x")).toEqual({ ok: true, value: "b" });

    runtimeA.dispose();
    runtimeB.dispose();
  });
});

/**
 * github.com/yaniv89/GameFactory/issues/4: `ForgeModule.setup()` may
 * return a thenable, which `ModuleBridge.setup()` now drives to real
 * completion via this method instead of dumping the live Promise handle
 * as an opaque value.
 */
describe("ModuleRuntime.callFunctionAsync", () => {
  async function makeRuntime(computeBudgetMs = 500) {
    const wasmModule = await buildWasmModuleFromEmbeddedBytes();
    return ModuleRuntime.create({ ...BASE_OPTIONS, computeBudgetMs, wasmModule });
  }

  /** Evaluates a function expression and hands back its live (undisposed) handle, mirroring how ModuleBridge captures the `setup` property. */
  function evalFunction(runtime: ModuleRuntime, code: string) {
    const result = runtime.context.evalCode(code);
    if (result.error) {
      const message = runtime.context.dump(result.error);
      result.error.dispose();
      throw new Error(`evalFunction: ${JSON.stringify(message)}`);
    }
    return result.value;
  }

  it("matches callFunction's outcome for a function that returns a plain, non-thenable value", async () => {
    const runtime = await makeRuntime();
    const fn = evalFunction(runtime, "(function () { return 42; })");

    const outcome = await runtime.callFunctionAsync(fn, []);
    fn.dispose();

    expect(outcome).toEqual({ ok: true, value: 42 });
    runtime.dispose();
  });

  it("awaits a resolved Promise return value to its settled value", async () => {
    const runtime = await makeRuntime();
    const fn = evalFunction(runtime, "(function () { return Promise.resolve(42); })");

    const outcome = await runtime.callFunctionAsync(fn, []);
    fn.dispose();

    expect(outcome).toEqual({ ok: true, value: 42 });
    runtime.dispose();
  });

  it("awaits a multi-hop .then() chain to its final resolved value", async () => {
    const runtime = await makeRuntime();
    const fn = evalFunction(
      runtime,
      `(function () {
        return Promise.resolve(1)
          .then(function (v) { return v + 1; })
          .then(function (v) { return v + 1; });
      })`,
    );

    const outcome = await runtime.callFunctionAsync(fn, []);
    fn.dispose();

    expect(outcome).toEqual({ ok: true, value: 3 });
    runtime.dispose();
  });

  it("awaits a real async function's return value, including work after an internal await", async () => {
    const runtime = await makeRuntime();
    const fn = evalFunction(
      runtime,
      `(async function () {
        const a = await Promise.resolve(1);
        const b = await Promise.resolve(2);
        return a + b;
      })`,
    );

    const outcome = await runtime.callFunctionAsync(fn, []);
    fn.dispose();

    expect(outcome).toEqual({ ok: true, value: 3 });
    runtime.dispose();
  });

  it("surfaces a rejected promise as a setup failure carrying the rejection's message", async () => {
    const runtime = await makeRuntime();
    const fn = evalFunction(runtime, "(function () { return Promise.reject(new Error('setup boom')); })");

    const outcome = await runtime.callFunctionAsync(fn, []);
    fn.dispose();

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.message).toBe("setup boom");
    }
    runtime.dispose();
  });

  it("reports a setup failure rather than hanging forever on a promise that never settles", async () => {
    const runtime = await makeRuntime(50); // short budget so the test itself stays fast
    const fn = evalFunction(runtime, "(function () { return new Promise(function () {}); })");

    const outcome = await runtime.callFunctionAsync(fn, []);
    fn.dispose();

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.message).toMatch(/did not settle within the compute budget/);
    }
  });
});
