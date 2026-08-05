#!/usr/bin/env node
/**
 * Structural discipline checks from CLAUDE.md Section 3.1 and 3.2:
 *
 *   1. packages/module-api has zero runtime dependencies and does not
 *      import from any other workspace package.
 *   2. packages/modules/* (first-party modules) import only from
 *      @forge/module-api and their own relative files — nothing else,
 *      proving the public Module API is sufficient to build them.
 *
 * This is "CI enforces this with a lint rule" from CLAUDE.md — implemented
 * as a small dependency-free script rather than adding ESLint (not listed
 * in CLAUDE.md Section 2) for a check this targeted.
 *
 * Usage: node tools/security/check-module-boundaries.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const IMPORT_RE = /(?:from\s+|require\()\s*["']([^"']+)["']/g;

function listSourceFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else if ([".ts", ".tsx"].includes(extname(entry)) && !entry.endsWith(".stories.tsx") && !entry.endsWith(".test.tsx"))
        out.push(full);
    }
  };
  walk(dir);
  return out;
}

function importsOf(file) {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(IMPORT_RE)].map((m) => m[1]);
}

let violations = 0;

// --- 1. @forge/module-api: zero deps, zero cross-package imports. ---
const moduleApiPkg = JSON.parse(
  readFileSync(join(ROOT, "packages/module-api/package.json"), "utf8"),
);
if (moduleApiPkg.dependencies && Object.keys(moduleApiPkg.dependencies).length > 0) {
  console.error(
    `check-module-boundaries: @forge/module-api must have zero runtime dependencies, found: ${Object.keys(moduleApiPkg.dependencies).join(", ")}`,
  );
  violations++;
}
for (const file of listSourceFiles(join(ROOT, "packages/module-api/src"))) {
  for (const spec of importsOf(file)) {
    if (spec.startsWith("@forge/") || spec.startsWith("forge-")) {
      console.error(
        `check-module-boundaries: @forge/module-api must not import other workspace packages — ${file.replace(ROOT, "")} imports "${spec}"`,
      );
      violations++;
    }
  }
}

// --- 2. packages/modules/*: only @forge/module-api or relative imports. ---
const modulesDir = join(ROOT, "packages/modules");
for (const moduleName of readdirSync(modulesDir)) {
  const srcDir = join(modulesDir, moduleName, "src");
  let files;
  try {
    files = listSourceFiles(srcDir);
  } catch {
    continue;
  }
  for (const file of files) {
    for (const spec of importsOf(file)) {
      const isRelative = spec.startsWith(".") || spec.startsWith("/");
      const isModuleApi = spec === "@forge/module-api";
      if (!isRelative && !isModuleApi) {
        console.error(
          `check-module-boundaries: packages/modules/${moduleName} may only import "@forge/module-api" or relative files — ${file.replace(ROOT, "")} imports "${spec}"`,
        );
        violations++;
      }
    }
  }
}

if (violations > 0) {
  console.error(`\ncheck-module-boundaries: ${violations} violation(s). See CLAUDE.md Section 3.1/3.2.`);
  process.exit(1);
}

console.log("check-module-boundaries: clean.");
