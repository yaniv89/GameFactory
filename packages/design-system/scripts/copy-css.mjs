#!/usr/bin/env node
/**
 * tsc only emits .ts/.tsx -> .js; every component's `import "./X.css"`
 * stays verbatim in the emitted JS, so dist/ needs its own copy of every
 * CSS file at the matching path or a cross-package consumer of the built
 * output (main: "dist/index.js") gets an unresolvable import at runtime.
 * Storybook doesn't hit this (it builds straight from src/), which is why
 * this gap went unnoticed until forge-editor became the first real
 * cross-package consumer of @forge/ds's compiled dist output.
 */
import { cpSync } from "node:fs";
import { extname, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const srcDir = join(root, "..", "src");
const distDir = join(root, "..", "dist");

cpSync(srcDir, distDir, {
  recursive: true,
  filter: (source) => extname(source) === "" || extname(source) === ".css",
});

console.log("copy-css: copied *.css from src/ to dist/");
