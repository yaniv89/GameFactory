#!/usr/bin/env node
/**
 * License compliance check (CLAUDE.md Section 4.9 gate #10 / Section 4.9
 * of docs/SPEC.md 10.4's spirit applied to dependencies rather than
 * modules). Runs `pnpm licenses list --json`, which groups installed
 * packages by SPDX license identifier, and fails if any license isn't in
 * the allowlist at tools/security/licenses.json.
 *
 * Usage: node tools/security/license-check.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url).pathname;
const allowlist = JSON.parse(
  readFileSync(new URL("./licenses.json", import.meta.url), "utf8"),
).allowed;

let raw;
try {
  raw = execFileSync("pnpm", ["licenses", "list", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  console.error("license-check: failed to run `pnpm licenses list --json`");
  console.error(err.message);
  process.exit(1);
}

const byLicense = JSON.parse(raw);
const disallowed = Object.keys(byLicense).filter((license) => !allowlist.includes(license));

if (disallowed.length > 0) {
  console.error("license-check: disallowed license(s) found:\n");
  for (const license of disallowed) {
    console.error(`  ${license}:`);
    for (const pkg of byLicense[license]) {
      console.error(`    - ${pkg.name}@${pkg.versions.join(",")}`);
    }
  }
  console.error(
    "\nAdd the license to tools/security/licenses.json only after confirming it's " +
      "compatible with redistributing exported games (docs/SPEC.md Section 15.3).",
  );
  process.exit(1);
}

console.log(
  `license-check: clean. ${Object.keys(byLicense).length} license(s) in use, all allowlisted.`,
);
