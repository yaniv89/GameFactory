// Mirrors packages/modules/dialogue/scripts/build-guest-bundle.mjs exactly
// — see that file's own doc comment for the full rationale. `bundle: true`
// inlines @forge/graph-nodes-core's real node definitions directly into
// this single IIFE; there is no cross-package boundary left at the
// sandbox level, only at build time (tools/security/check-module-boundaries.mjs
// is what enforces graph-nodes-core itself stays clean).
import { build } from "esbuild";

await build({
  entryPoints: ["src/guestEntry.ts"],
  outfile: "dist/guest-bundle.js",
  bundle: true,
  format: "iife",
  platform: "neutral",
  target: "es2020",
  logLevel: "info",
  // platform:"neutral" otherwise ignores package.json's "main" field
  // entirely (no default mainFields for that platform) — needed here,
  // unlike dialogue's own copy of this script, because this package
  // actually resolves a real cross-package import (@forge/graph-nodes-core)
  // at bundle time.
  mainFields: ["main"],
});
