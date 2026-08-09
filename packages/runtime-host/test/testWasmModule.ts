import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { newQuickJSWASMModuleFromVariant, newVariant, RELEASE_SYNC, type QuickJSWASMModule } from "quickjs-emscripten";

/**
 * Reads `@jitl/quickjs-wasmfile-release-sync`'s own `.wasm` bytes straight
 * off disk via `fs.readFileSync` and builds a `QuickJSWASMModule` from
 * them via `newVariant({ wasmBinary })` — the same, real no-network path
 * `ModuleRuntimeOptions.wasmModule`'s own doc comment describes the
 * standalone `forge export` player (M6 Phase 5) using, not
 * `getQuickJS()`'s `fetch()`/`XMLHttpRequest` loading. Shared between
 * moduleRuntime.test.ts and moduleBridge.test.ts rather than duplicated —
 * both need to prove the override against the real mechanism, not a mock
 * standing in for it.
 */
export async function buildWasmModuleFromEmbeddedBytes(): Promise<QuickJSWASMModule> {
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
