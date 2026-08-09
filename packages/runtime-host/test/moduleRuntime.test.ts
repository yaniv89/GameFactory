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
