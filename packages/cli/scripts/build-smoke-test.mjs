// Same reasoning as packages/player/scripts/build-smoke-test.mjs and
// packages/runtime-host/scripts/build-smoke-cli.mjs: tsc's own per-file
// ESM output isn't directly node-runnable across package boundaries
// (this test reaches into @forge/player's own compiled dist/ transitively
// via runExport), so this bundles it into one self-contained file.
import { build } from "esbuild";

await build({
  entryPoints: ["src/smoke/smokeTest.ts"],
  outfile: "dist/smoke/smokeTest.bundle.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  logLevel: "info",
});
