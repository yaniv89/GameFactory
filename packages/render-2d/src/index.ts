// Must stay the first import, and a real one (not something a
// bundler/linter could tree-shake as unused): its only job is a
// module-level side effect. PixiJS's UboSystem/GlShaderSystem/etc.
// default to a `new Function`-based fast path and hard-throw ("Current
// environment does not allow unsafe-eval") the instant a real CSP
// actually blocks eval — confirmed with a real Chromium run against
// docs/adr/0010's play-origin CSP, the first context in this codebase
// that ever exercises a strict CSP against this renderer (the editor's
// vite dev server sends no CSP at all; file:// exports run under no CSP
// either). Despite the misleading package name, `pixi.js/unsafe-eval`
// does NOT require CSP's `unsafe-eval` — confirmed by reading its own
// source before adding this: it installs real, eval-free polyfills and
// only then silences the check. Lives here, not in packages/player or
// the editor's own scene canvas code, because this is "the one renderer"
// CLAUDE.md Section 2.2 names both of them as sharing — fixing it once
// here fixes it for both, and the editor's own scene canvas has this
// exact same latent exposure the moment it's ever served with a real
// CSP (not yet exercised by any existing test, since the vite dev
// server never sends one). The correct fix for a strict CSP is this
// import, never adding 'unsafe-eval' to script-src (CLAUDE.md Section
// 1.1 guardrail 2, no exceptions).
import "pixi.js/unsafe-eval";

export * from "./camera";
export * from "./tileGrid";
export * from "./entityDiff";
export * from "./interpolation";
export * from "./spriteSync";
export * from "./tilemapLayer";
export * from "./renderHost";
