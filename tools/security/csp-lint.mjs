#!/usr/bin/env node
/**
 * CSP linter (CLAUDE.md Section 4.9 gate #9): fails on any wildcard,
 * `unsafe-eval`, or `unsafe-inline` in a `script-src` directive found in
 * source config files. Scans actual configuration source (.cs/.ts/.tsx/
 * .mjs/.cjs/.json), not documentation — docs/SPEC.md and CLAUDE.md contain
 * the same policy text as prose/reference and are deliberately excluded.
 *
 * Token match is exact, not substring: 'wasm-unsafe-eval' must NOT trip
 * the 'unsafe-eval' check, since it is a distinct, permitted CSP keyword
 * (required for the QuickJS-WASM sandbox interpreter, docs/SPEC.md 10.2).
 *
 * Usage: node tools/security/csp-lint.mjs
 * Exit code 0 = clean, 1 = violation found, listed with file:line.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const SCAN_DIRS = ["services", "packages"];
const SCAN_EXTENSIONS = new Set([".cs", ".ts", ".tsx", ".mjs", ".cjs", ".json"]);
const EXCLUDE_DIRS = new Set(["node_modules", "dist", "storybook-static", "bin", "obj", ".storybook"]);

const FORBIDDEN_TOKENS = new Set(["'unsafe-eval'", "'unsafe-inline'", "*", "https:", "http:"]);

/** @type {string[]} */
const files = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full);
    } else if (SCAN_EXTENSIONS.has(extname(entry))) {
      files.push(full);
    }
  }
}

for (const dir of SCAN_DIRS) {
  walk(join(ROOT, dir));
}

let violations = 0;

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    const match = /script-src([^;"'\\]*(?:\\'[^;"'\\]*)*)/i.exec(line);
    if (!match) return;
    // Re-extract the raw directive value including quoted tokens, up to a
    // terminator (unescaped quote/semicolon ending the CSP string, or EOL).
    const startIdx = line.toLowerCase().indexOf("script-src");
    const rest = line.slice(startIdx + "script-src".length);
    const terminatorMatch = /(;|" \+|"\s*$|'\s*$)/.exec(rest);
    const directiveValue = terminatorMatch
      ? rest.slice(0, terminatorMatch.index)
      : rest;
    const tokens = directiveValue
      .replace(/\\'/g, "'")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    for (const token of tokens) {
      if (FORBIDDEN_TOKENS.has(token)) {
        console.error(
          `csp-lint: forbidden script-src token ${token} at ${file.replace(ROOT, "")}:${i + 1}`,
        );
        violations++;
      }
    }
  });
}

if (violations > 0) {
  console.error(`\ncsp-lint: ${violations} violation(s) found. See CLAUDE.md Section 1.1 guardrail 2 and Section 4.4.`);
  process.exit(1);
}

console.log(`csp-lint: clean (${files.length} files scanned).`);
