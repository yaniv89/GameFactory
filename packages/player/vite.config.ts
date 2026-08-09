import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, not Vite's default "/assets/..." absolute base
  // — docs/SPEC.md Section 15.3's file:// requirement is the whole reason
  // this package exists, and an absolute base has no origin to resolve
  // against under file://, breaking every asset reference immediately.
  base: "./",
  build: {
    outDir: "dist-app",
    // Real, load-bearing finding, not a guess: Chrome enforces CORS for
    // *every* ES module load under file:// — a relative `<script
    // type="module" src="./assets/x.js">` is blocked ("Access... blocked
    // by CORS policy... origin 'null'"), and so is a runtime `import()` of
    // any separate chunk (confirmed both independently with a real
    // Playwright file:// load before adding this). Vite's default output
    // is always split into an entry chunk plus lazy chunks (here,
    // PixiJS's own WebGPU/WebGL/Canvas renderer auto-detection each
    // dynamically imports its own chunk) — none of that can load under
    // file:// no matter how the entry script itself is delivered.
    // `inlineDynamicImports` forces Rollup to fold every reachable
    // dynamic import into one file, so there is nothing left for the
    // browser to load separately at all.
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
      // ModuleRuntime.create() (packages/runtime-host/src/sandbox/moduleRuntime.ts)
      // has a fallback dynamic `import("quickjs-emscripten")` for callers
      // that don't supply `wasmModule` — this package's own gameLogic.ts
      // always supplies one, so that branch is genuinely dead code here,
      // but Vite/Rollup can't prove that statically and bundles the whole
      // reachable graph anyway: confirmed by actually building without
      // this exclusion first, which copied all four quickjs-emscripten
      // build variants' own .wasm files (~4.2 MB, release/debug x
      // sync/async) into dist-app/assets, none of them ever fetched at
      // runtime. Marking the bare specifier external drops that entire
      // unreachable-in-practice subgraph from the export.
      external: ["quickjs-emscripten"],
    },
    // The single inlined file is expected to be well past the default
    // 500 kB warning threshold (PixiJS's full renderer set, no code
    // splitting by design above) — a real, understood trade-off for
    // file://-compatibility, not noise to silence blindly.
    chunkSizeWarningLimit: 2000,
  },
});
