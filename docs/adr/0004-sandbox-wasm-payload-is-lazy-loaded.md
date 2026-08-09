# 4. The QuickJS sandbox payload is lazy-loaded, not bundled into `@forge/runtime-host`'s static budget

Date: 2026-08-06

## Status

Accepted

## Context

CLAUDE.md Section 4.2 requires third-party runtime module code to execute only inside `quickjs-emscripten` in a dedicated Web Worker — non-negotiable. Separately, CLAUDE.md Section 7 / `docs/SPEC.md` Section 18.1 pin `@forge/runtime-host`'s gzipped bundle budget at 60 KB target, 80 KB hard-fail, as part of a documented ~235 KB total engine floor "before any game content or Modules."

At the start of M2 Phase 3, before writing any sandbox implementation, the actual size of the QuickJS WASM interpreter was measured directly (the `release-sync` variant of `quickjs-emscripten`, the correct one for production — not `debug-*`): **~228 KB gzipped for the WASM binary alone**, before any of `@forge/runtime-host`'s own lifecycle or capability-bridge code. That's already 3–4x over the *hard-fail* budget, let alone the target — a structural fact about shipping a WASM JS interpreter, not a regression introduced by careless implementation.

This is a direct conflict between two of this project's own non-negotiable constraints: the security mandate (Section 4.2) and the performance budget (Section 7), both stated as CI-enforced. CLAUDE.md Section 12 explicitly lists "a request to raise a performance budget to unblock a release" as something to push back on and ask "what regressed and why" first — this isn't quite that (nothing regressed; the conflict was latent since the day both numbers were pinned, just never checked against each other), but the spirit applies: silently building around it, or silently proposing a bigger budget number, would both be the wrong move without surfacing it.

A second, related question came up while resolving this: does this WASM cost apply to *every* published game, or only to games that actually use third-party (community marketplace) Modules? `docs/SPEC.md` Section 10.2 Option 2 ("native JS in a `srcdoc` iframe... reasonable for first-party and verified-publisher modules only, as a performance tier") implies first-party modules (`@forge/dialogue`, `@forge/inventory`, `@forge/turn-battle`) could eventually skip the sandbox. But Option 2 is explicitly framed as an "opt-in fast path" layered *on top of* Option 1 being the default — and the Partner trust tier that would make "verified publisher" meaningful (`docs/SPEC.md` Section 16.3: "Verified plus a security audit and an SLA") depends on marketplace infrastructure that doesn't exist until M6/M7. Building the native fast path now, before that trust infrastructure exists, would mean either running first-party modules trusted-by-fiat (undermining the dogfooding value of "first-party modules use the same API as everyone else" — CLAUDE.md Section 3.2) or inventing an ad-hoc trust mechanism that gets thrown away once the real one lands.

## Decision

1. **The QuickJS WASM payload is fetched lazily, on first module instantiation** — not bundled into `@forge/runtime-host`'s static output. A project with zero installed Modules never loads it. A project with at least one Module (first-party or third-party) loads it once; the browser caches it thereafter (standard HTTP caching on a content-hashed asset URL — no custom cache logic needed).
2. **`@forge/runtime-host`'s existing 60 KB / 80 KB budget now covers only the static lifecycle and capability-bridge glue code** — the part that's genuinely always shipped. This is realistic to hit; it was never the WASM interpreter's budget to begin with, that was simply never checked until now.
3. **A new, separate budget line covers the lazy WASM payload**: 250 KB target / 320 KB hard-fail, gzipped (measured baseline: 228 KB — some headroom kept for the capability-bridge glue that eventually ships alongside it inside the same Worker). Enforced today, for real, by `tools/bench/check-bundle-size.mjs`'s new `wasmPayloads` check — this isn't a proxy metric like the JS packages' tsc-output measurement; a WASM binary's gzipped size doesn't change when it's later bundled, so this number is already the real one.
4. **For now, first-party modules go through the same sandbox as third-party modules — no native fast path is built in M2.** This keeps exactly one execution path to secure and test (`sandbox-escape.test.ts` covers everything), matches Option 2's own framing as an opt-in addition rather than the default, and avoids inventing a throwaway trust mechanism before the Partner tier's real one exists. Consequence: essentially any real game (which, per the whole premise of Forge, uses at least dialogue or inventory) pays the lazy WASM cost once. That's an honest, documented cost of the security architecture, not something to hide.

## Consequences

- `docs/SPEC.md` Section 8.1's "~235 KB total engine floor" claim stays accurate for the always-shipped baseline; the sandbox payload is now separately tracked, not silently absent from any budget.
- Revisit the native-fast-path question (Option 2) when the Partner trust tier actually exists (M6/M7) — this ADR does not rule it out, it just refuses to build it early on borrowed trust.
- `packages/runtime-host`'s Worker bootstrap (M2 Phase 3) must be structured so the `quickjs-emscripten` import/WASM fetch is genuinely deferred — a dynamic `import()` triggered by "a module is about to be instantiated," not a static top-level import that would defeat the whole point of this ADR by pulling the WASM into whatever bundle contains the lifecycle code.
- `tools/bench/budgets.json`'s new `wasmPayloads` array is the pattern for any future lazy-loaded binary asset budget (e.g., if a second sandbox variant or a debug build ever needs its own tracked number).
