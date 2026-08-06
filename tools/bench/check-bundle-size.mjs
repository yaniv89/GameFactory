#!/usr/bin/env node
/**
 * Performance budget harness (CLAUDE.md Section 7, docs/SPEC.md Section
 * 18.1). Builds each engine package with its existing `pnpm --filter <pkg>
 * run build` (tsc), gzips its compiled output, and fails if the total
 * exceeds the hard-fail budget in tools/bench/budgets.json.
 *
 * ⚠ Proxy metric, not the final number: this gzips tsc's per-file output
 * (unbundled, untree-shaken, unminified module graph), not a real
 * production bundle. The real measurement — a single tree-shaken,
 * minified bundle per docs/SPEC.md Section 8.1 — lands with the actual
 * build pipeline in Milestone M1 (@forge/core, @forge/render-2d) and M2
 * (@forge/runtime-host). Wiring the budget-vs-actual comparison and CI
 * gate now, against real numbers later, is the point: a budget introduced
 * after the code exists is a budget that gets raised (CLAUDE.md Section 7
 * intro).
 *
 * Also checks `wasmPayloads`: real, npm-resolvable binary assets (the
 * QuickJS sandbox interpreter — see docs/adr/0004) that are lazy-loaded
 * rather than bundled into a package's static output, so they can't be
 * measured by gzipping `dist/*.js` the way the packages above are. These
 * ARE the final number already — a WASM binary doesn't get smaller by
 * bundling — so they're not a proxy metric the way the JS packages are.
 *
 * Usage: node tools/bench/check-bundle-size.mjs
 */
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { createRequire } from "node:module";

const ROOT = new URL("../../", import.meta.url).pathname;
const { packages, wasmPayloads = [] } = JSON.parse(
  readFileSync(new URL("./budgets.json", import.meta.url), "utf8"),
);
// pnpm's strict node_modules isolation means a transitive dependency like
// @jitl/quickjs-wasmfile-release-sync is only resolvable from within the
// package that actually depends on it (quickjs-emscripten), not from
// runtime-host's own node_modules — so resolution starts from there.
const quickjsEmscriptenRequire = createRequire(new URL("../../packages/runtime-host/package.json", import.meta.url));
const require = createRequire(quickjsEmscriptenRequire.resolve("quickjs-emscripten"));

function collectJsFiles(dir) {
  const out = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(d, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if (extname(entry) === ".js") out.push(full);
    }
  };
  walk(dir);
  return out;
}

function gzippedSizeKB(files) {
  let totalBytes = 0;
  for (const file of files) {
    const contents = readFileSync(file);
    totalBytes += gzipSync(contents, { level: 9 }).length;
  }
  return totalBytes / 1024;
}

let hardFailures = 0;
let warnings = 0;

for (const pkg of packages) {
  const pkgDir = join(ROOT, pkg.path);
  try {
    execFileSync("pnpm", ["--filter", pkg.name, "run", "build"], {
      cwd: ROOT,
      stdio: "inherit",
    });
  } catch (err) {
    console.error(`check-bundle-size: build failed for ${pkg.name}`);
    process.exit(1);
  }

  const jsFiles = collectJsFiles(join(pkgDir, "dist"));
  const sizeKB = gzippedSizeKB(jsFiles);
  const sizeStr = sizeKB.toFixed(2);

  if (sizeKB > pkg.hardFailKB) {
    console.error(
      `check-bundle-size: ${pkg.name} is ${sizeStr} KB gzipped — exceeds the hard-fail budget of ${pkg.hardFailKB} KB.`,
    );
    hardFailures++;
  } else if (sizeKB > pkg.targetKB) {
    console.warn(
      `check-bundle-size: ${pkg.name} is ${sizeStr} KB gzipped — over target (${pkg.targetKB} KB) but under hard-fail (${pkg.hardFailKB} KB).`,
    );
    warnings++;
  } else {
    console.log(`check-bundle-size: ${pkg.name} is ${sizeStr} KB gzipped (target ${pkg.targetKB} KB). OK.`);
  }
}

for (const asset of wasmPayloads) {
  let assetPath;
  try {
    assetPath = require.resolve(asset.resolve);
  } catch (err) {
    console.error(`check-bundle-size: could not resolve "${asset.resolve}" for "${asset.name}": ${err.message}`);
    hardFailures++;
    continue;
  }

  const sizeKB = gzipSync(readFileSync(assetPath), { level: 9 }).length / 1024;
  const sizeStr = sizeKB.toFixed(2);

  if (sizeKB > asset.hardFailKB) {
    console.error(
      `check-bundle-size: ${asset.name} is ${sizeStr} KB gzipped — exceeds the hard-fail budget of ${asset.hardFailKB} KB.`,
    );
    hardFailures++;
  } else if (sizeKB > asset.targetKB) {
    console.warn(
      `check-bundle-size: ${asset.name} is ${sizeStr} KB gzipped — over target (${asset.targetKB} KB) but under hard-fail (${asset.hardFailKB} KB).`,
    );
    warnings++;
  } else {
    console.log(`check-bundle-size: ${asset.name} is ${sizeStr} KB gzipped (target ${asset.targetKB} KB). OK.`);
  }
}

if (hardFailures > 0) {
  console.error(`\ncheck-bundle-size: ${hardFailures} package(s)/asset(s) over hard-fail budget. See CLAUDE.md Section 7.`);
  process.exit(1);
}

console.log(`\ncheck-bundle-size: clean (${warnings} warning(s)).`);
