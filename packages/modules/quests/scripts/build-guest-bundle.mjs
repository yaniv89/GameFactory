// Compiles src/guestEntry.ts into a single, dependency-free IIFE
// (dist/guest-bundle.js) — the actual string a real ModuleBridge.setup()
// call evaluates inside QuickJS. `tsc`'s own `dist/index.js` (the
// package's normal build) stays plain ES module output for
// PreviewApp's unsandboxed directModuleHost.ts to import directly; this
// is a second, separate artifact for the sandboxed path, since QuickJS's
// guest realm has no module resolution to satisfy an `import` statement
// with.
//
// `platform: "neutral"` deliberately assumes neither Node's nor a real
// browser's globals — QuickJS's guest realm has neither `process` nor
// `window`/`document`, only whatever ModuleBridge's own prelude installs
// (packages/runtime-host/src/module/prelude.ts).
import { build } from "esbuild";

await build({
  entryPoints: ["src/guestEntry.ts"],
  outfile: "dist/guest-bundle.js",
  bundle: true,
  format: "iife",
  platform: "neutral",
  target: "es2020",
  logLevel: "info",
});
