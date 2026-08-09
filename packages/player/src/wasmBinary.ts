// Imports the variant machinery from quickjs-emscripten-core and the one
// wasmfile variant this actually uses directly, NOT from the top-level
// "quickjs-emscripten" package — that package's own index.ts re-exports
// all four variants (RELEASE_SYNC, RELEASE_ASYNC, DEBUG_SYNC, DEBUG_ASYNC)
// as one barrel, and Vite's static asset scanner picks up all four
// variants' own bundled .wasm files as a result (confirmed by actually
// building and inspecting dist-app/assets: importing from the barrel
// copied ~4.2 MB across four .wasm files into the export, none of them
// ever fetched at runtime since buildWasmModuleFromBase64 below never
// touches network/XHR at all). Importing the one variant this file
// actually needs keeps only RELEASE_SYNC's own .wasm in the build graph.
import { newQuickJSWASMModuleFromVariant, newVariant, type QuickJSWASMModule } from "quickjs-emscripten-core";
import RELEASE_SYNC from "@jitl/quickjs-wasmfile-release-sync";

/**
 * Builds a real `QuickJSWASMModule` from base64-encoded WASM bytes —
 * `newVariant({ wasmBinary })` is documented, first-party
 * `quickjs-emscripten-core` API for exactly this (see
 * `ModuleRuntimeOptions.wasmModule`'s own doc comment,
 * `packages/runtime-host/src/sandbox/moduleRuntime.ts`), not a hack.
 * The exported build (`forge export`, M6 Phase 5e) generates the base64
 * string at build time (from the same `.wasm` file
 * `@jitl/quickjs-wasmfile-release-sync` ships) and bundles it as a plain
 * JS string constant — this function only ever decodes it, never fetches
 * it, so it works identically whether the page was opened over `https://`
 * or `file://`.
 */
export async function buildWasmModuleFromBase64(base64: string): Promise<QuickJSWASMModule> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return newQuickJSWASMModuleFromVariant(newVariant(RELEASE_SYNC, { wasmBinary: bytes.buffer }));
}
