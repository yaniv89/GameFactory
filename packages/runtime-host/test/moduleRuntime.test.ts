import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { newQuickJSWASMModuleFromVariant, newVariant, RELEASE_SYNC, type QuickJSWASMModule } from "quickjs-emscripten";
import { describe, expect, it } from "vitest";
import { ModuleRuntime } from "../src/sandbox/moduleRuntime";

const BASE_OPTIONS = {
  memoryLimitBytes: 4 * 1024 * 1024,
  maxStackSizeBytes: 1024 * 1024,
  computeBudgetMs: 500,
};

/**
 * Reads `@jitl/quickjs-wasmfile-release-sync`'s own `.wasm` bytes straight
 * off disk via `fs.readFileSync` and builds a `QuickJSWASMModule` from
 * them via `newVariant({ wasmBinary })` — deliberately not
 * `getQuickJS()`, which resolves its WASM through the emscripten loader's
 * own `fetch()`/`XMLHttpRequest` path. That path is exactly what the
 * standalone `forge export` player (M6 Phase 5) cannot use: confirmed by
 * reading `@jitl/quickjs-wasmfile-release-sync`'s own emscripten loader
 * (`emscripten-module.mjs`) that both `fetch()` and XHR are its only
 * browser-side loading mechanisms, and Chrome blocks both under a
 * `file://` origin. This helper exercises the one documented, first-party
 * escape hatch instead — the same one the exported build's own boot code
 * will use — so `ModuleRuntimeOptions.wasmModule` is proven against the
 * real no-network path, not a mock standing in for it.
 */
async function buildWasmModuleFromEmbeddedBytes(): Promise<QuickJSWASMModule> {
  const require = createRequire(import.meta.url);
  // `@jitl/quickjs-wasmfile-release-sync` is `quickjs-emscripten`'s own
  // transitive dependency, not `runtime-host`'s — pnpm's strict
  // node_modules only exposes it to a `require.resolve` rooted at
  // `quickjs-emscripten`'s own directory, not this test file's.
  const quickjsEmscriptenPkgJson = require.resolve("quickjs-emscripten/package.json");
  const wasmfilePkgJson = require.resolve("@jitl/quickjs-wasmfile-release-sync/package.json", {
    paths: [dirname(quickjsEmscriptenPkgJson)],
  });
  const wasmPath = join(dirname(wasmfilePkgJson), "dist", "emscripten-module.wasm");
  const wasmBinary = readFileSync(wasmPath);
  const arrayBuffer = wasmBinary.buffer.slice(wasmBinary.byteOffset, wasmBinary.byteOffset + wasmBinary.byteLength);
  const variant = newVariant(RELEASE_SYNC, { wasmBinary: arrayBuffer });
  return newQuickJSWASMModuleFromVariant(variant);
}

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
