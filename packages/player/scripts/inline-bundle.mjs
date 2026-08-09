// Post-processes `vite build`'s own dist-app/ output into something that
// actually loads under file:// — real, load-bearing, not cosmetic.
// Chrome enforces CORS for every ES module load under a file:// origin
// ("origin 'null'"), including a plain relative `<script type="module"
// src="./assets/x.js">` — confirmed with a real Playwright file:// load
// before writing this, not assumed. vite.config.ts's own
// `inlineDynamicImports` already collapses every *runtime* dynamic
// import (PixiJS's WebGPU/WebGL/Canvas renderer auto-detection chunks)
// into the one entry file; this script does the other half — inlining
// that entry file directly into index.html as an inline module script,
// which isn't a `src=` fetch at all and so isn't subject to the same
// restriction.
//
// Also drops any asset the inlined HTML no longer references — in
// practice, `@jitl/quickjs-wasmfile-release-sync`'s own bundled
// `.wasm` file, which Vite's static analysis still copies into
// dist-app/assets even though this package only ever loads WASM via
// its own base64-embedded copy (wasmBinary.ts), never that file
// (confirmed the same way: build, delete it, reload under file://,
// still boots).
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

export function inlineBundle(distDir) {
  const indexPath = join(distDir, "index.html");
  let html = readFileSync(indexPath, "utf8");

  const assetsDir = join(distDir, "assets");
  const jsFiles = readdirSync(assetsDir).filter((name) => extname(name) === ".js");
  if (jsFiles.length !== 1) {
    throw new Error(
      `inlineBundle: expected exactly one .js asset (inlineDynamicImports should collapse everything into one) — found ${jsFiles.length}: ${jsFiles.join(", ")}`,
    );
  }
  const jsFile = jsFiles[0];
  const jsSource = readFileSync(join(assetsDir, jsFile), "utf8");

  const scriptTagPattern = new RegExp(`<script[^>]*src="\\./assets/${jsFile}"[^>]*></script>`);
  if (!scriptTagPattern.test(html)) {
    throw new Error(`inlineBundle: could not find a <script> tag referencing ./assets/${jsFile} in index.html`);
  }
  html = html.replace(scriptTagPattern, () => `<script type="module">${jsSource}</script>`);
  writeFileSync(indexPath, html);
  rmSync(join(assetsDir, jsFile));

  // Drop any asset the now-inlined HTML doesn't reference by name — real
  // check against the actual output, not an assumption about which
  // files are "supposed to" be unused.
  for (const name of readdirSync(assetsDir)) {
    if (!html.includes(name)) rmSync(join(assetsDir, name));
  }
}
