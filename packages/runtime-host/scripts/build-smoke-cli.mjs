// docs/SPEC.md Section 10.4 gate 4: `services/Forge.Functions.Scan` spawns
// this as a plain Node subprocess, so it has to be an actual
// standalone-runnable file — tsc's normal per-file ESM output leaves
// extension-less relative import specifiers (`from "./smokeRunner"`),
// which Node's own ESM loader refuses to resolve outside a bundler
// (confirmed by actually running `node dist/smoke/cli.js` before writing
// this, not assumed). Every other consumer in this monorepo either goes
// through a bundler (Vite) or imports the TS source directly (Vitest), so
// this is the first place that distinction actually matters.
import { build } from "esbuild";

await build({
  entryPoints: ["src/smoke/cli.ts"],
  outfile: "dist/smoke/cli.bundle.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // quickjs-emscripten resolves its own .wasm payload relative to its own
  // package location at runtime — confirmed by actually running the
  // bundle, not assumed: inlining its JS here left the WASM loader
  // looking for the file next to *this* bundle instead
  // ("ENOENT ... dist/smoke/emscripten-module.wasm"). Left external, its
  // dynamic `import("quickjs-emscripten")` (moduleRuntime.ts, per
  // docs/adr/0004) resolves normally through node_modules at runtime,
  // exactly like every other consumer in this repo already does — this
  // CLI is deployed alongside a real node_modules (Section 10.4's "fresh
  // container per job" already implies a real package install, not a
  // single static binary), so that's a real dependency, not a gap.
  external: ["quickjs-emscripten"],
  logLevel: "info",
});
