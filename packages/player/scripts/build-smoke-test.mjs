// Bundles src/smoke/smokeTest.ts into one self-contained, plain-Node-runnable
// file — the exact same gap and fix as
// packages/runtime-host/scripts/build-smoke-cli.mjs's own comment
// documents: tsc's per-file ESM output leaves extension-less relative
// import specifiers Node's own ESM loader refuses to resolve outside a
// bundler, and that gap runs deep here (confirmed by actually running it,
// not assumed) — it isn't just this package's own src/*.ts, it's
// @forge/core's compiled dist/ output too, which this package imports as
// a real dependency. Bundling the whole graph into one file sidesteps it
// entirely, the same way every other Vite-bundled consumer in this repo
// (the editor) already avoids it without knowing it exists.
//
// quickjs-emscripten stays external for the same reason build-smoke-cli.mjs
// keeps it external: it resolves its own .wasm payload relative to its own
// package location at runtime, and inlining its JS here would break that
// (confirmed the same way, not assumed).
//
// jsdom stays external too: it does its own conditional/dynamic requires
// internally (parser and canvas fallbacks) that static bundling tends not
// to resolve cleanly. Leaving it as a real node_modules resolution at
// runtime (this script's own outfile is run via plain `node` from this
// package's own directory, where jsdom is a real devDependency) sidesteps
// that risk entirely rather than betting on esbuild handling it.
import { build } from "esbuild";

await build({
  entryPoints: ["src/smoke/smokeTest.ts"],
  outfile: "dist/smoke/smokeTest.bundle.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["quickjs-emscripten", "jsdom"],
  logLevel: "info",
});
