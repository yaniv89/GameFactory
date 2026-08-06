# Sandbox Design — the QuickJS module runtime boundary

Status: living document, written at the start of Milestone M2 per CLAUDE.md
Section 4.2 / `docs/security/THREAT-MODEL.md` Section 3.1. Covers the
runtime sandbox only (third-party Module code executing in a player's
browser) — not the build-worker sandbox (`docs/SPEC.md` Section 10.4's
publishing pipeline) or the editor's declarative-schema UI sandbox
(`docs/SPEC.md` Section 9.5), which are separate trust boundaries with
separate mitigations.

## 1. What this document is

An adversarial write-up: for each threat this boundary exists to contain,
what specifically stops it, and what's actually been verified versus
still assumed. `packages/runtime-host/test/sandbox-escape.test.ts`
(M2's exit criterion) is where every "verified" claim below gets an
automated, re-runnable proof — this document is the design the tests are
checked against, not a substitute for them.

## 2. Chosen approach

Per `docs/SPEC.md` Section 10.2 Option 1: **QuickJS compiled to WASM,
running in a dedicated Web Worker**, via the `quickjs-emscripten` npm
package (MIT license, v0.32.0). No alternative was seriously
re-evaluated here — Section 10.2 already ranked the three options and
recommended this one; this document picks up from that decision.

### 2.1 What's been empirically verified already (not just documented)

Before designing anything further, the library's actual behavior was
tested directly in a real dedicated Web Worker in headless Chromium
(the sandbox's pre-installed browser via Playwright), because the
library's own README documents browser and Cloudflare Workers support
but never explicitly says "dedicated Web Worker" — that combination
needed checking, not assuming, before anything else in this document
could be trusted.

Result, run for real, not inferred from docs:

| Check | Result |
|---|---|
| QuickJS WASM module initializes inside a dedicated Worker (`new Worker(...)`, classic, `importScripts`) | ✅ Works. `1 + 1` evaluated inside the interpreter returns `2`. |
| Evaluated code has no reference to the Worker's own scope | ✅ `typeof window`, `typeof self`, `typeof importScripts` are all `"undefined"` from *inside* QuickJS-evaluated code. |
| Classic same-realm sandbox-escape probe (`({}).constructor.constructor('return this')()`) | ✅ Does not return the host's `globalThis`/`self` — returns a QuickJS-internal object. This is the exact technique that defeats naive `Function`-constructor-based JS sandboxes; it fails here because QuickJS's `Function` constructor only ever builds QuickJS-interpreted functions bound to the QuickJS global object. |
| `runtime.setInterruptHandler()` — does it fire often enough to be useful as a compute budget? | ✅ 4,742 calls in a 200ms tight `while(true){}` loop. Fine-grained enough for a per-frame budget. |
| `runtime.setInterruptHandler()` actually stops a hostile infinite loop | ✅ `while (true) {}` interrupted at 201ms against a 200ms deadline (`InternalError: interrupted`), catchable, no tab hang. |
| `runtime.setMemoryLimit()` actually stops a hostile allocation bomb | ✅ A 10M-iteration string-accumulation loop against a 1MB limit threw a catchable `InternalError: out of memory` — no crash, no host-process memory spike. |

None of this is a substitute for the real fixture suite (Phase 5) — it's
the minimum "does the premise of this whole milestone actually hold"
check that had to happen before investing in the architecture below.

### 2.2 What is explicitly NOT verified, and why it still matters

`quickjs-emscripten`'s own README states plainly: **"This project makes
every effort to be secure, but has not been audited. Please use with
care in production settings."** That's the JS/WASM binding layer, not
QuickJS-the-C-interpreter itself (which is mature and widely deployed —
notably by Figma's plugin sandbox, cited in the library's own
background section) — but the binding layer is exactly where a subtle
bridge-protocol bug would live if one exists.

This is precisely why `docs/SPEC.md` Section 21 Risk R3 already requires
an **external security audit before Phase 3** launch, independent of
whatever this milestone proves internally. M2's job is to build the
boundary correctly and prove it holds against the fixtures we can think
of; it is not a substitute for that audit, and nothing here should be
read as claiming otherwise.

## 3. Isolation architecture

**One `QuickJSRuntime` per module instance, never shared across modules
or across untrusted sources.** This directly follows the library's own
documented guidance: "You should create separate runtime instances for
untrusted code from different sources for isolation." A `QuickJSRuntime`
is the WASM-heap-level boundary; contexts within the same runtime *can*
share values, so two modules must never share a runtime even if they
share a context would otherwise be convenient.

```
┌─────────────────────────────────────────────────────────────┐
│ play.forge.dev (game origin)                                  │
│                                                                 │
│  ┌───────────────┐        ┌──────────────────────────────┐  │
│  │  Main thread    │        │  Dedicated Worker (per module) │  │
│  │  - ECS World    │◄──────►│  - QuickJSRuntime (1 per mod)  │  │
│  │  - Scheduler    │postMsg │  - QuickJSContext              │  │
│  │  - Renderer     │ (only) │  - Module bytecode evaluated    │  │
│  │  - Capability   │        │    here, nowhere else           │  │
│  │    broker        │        │  - No window/self/importScripts │  │
│  └───────────────┘        │    reachable from evaluated code│  │
│                             └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

Each Worker hosts exactly one module's runtime. A game with five
installed modules runs five Workers, not one Worker juggling five
runtimes — the Worker boundary and the runtime boundary are the same
boundary, deliberately, so a Worker crash/termination cleanly bounds the
blast radius to one module.

## 4. The capability bridge: the single most important protocol in this system

**Rule: every value crossing the host↔guest boundary is decomposed into
primitives (numbers, strings, booleans, plain data) on the way in and
`dump()`'d into plain JS on the way out. No live object reference, no
function reference, no closure ever crosses in either direction except
the specific bridge functions the capability model explicitly grants.**

This is the rule most likely to be violated accidentally, because
`quickjs-emscripten`'s ergonomics make it easy to hand a QuickJS
function a JS closure that captures host state — which is exactly how a
capability function is *supposed* to work, but the closure itself must
never leak a reference to anything beyond the specific narrow operation
it performs.

Concrete pattern for every capability function:

```typescript
// CORRECT: the closure captures only the specific host object this one
// capability needs, and returns/receives only primitives via vm.new*/vm.dump.
const setPositionHandle = vm.newFunction("setPosition", (xHandle, yHandle) => {
  const x = vm.getNumber(xHandle);
  const y = vm.getNumber(yHandle);
  entityBridge.setPosition(currentEntityId, x, y); // host-side, narrow, capability-checked
  // no return value crosses back; if one did, it would be vm.newNumber(...) etc,
  // never a handle wrapping a live host object.
});
```

```typescript
// WRONG — never do this: a bridge function that hands the guest a handle
// wrapping a live host object (even indirectly, via vm.newObject() + setProp
// pointing at something host-mutable) creates a channel for the guest to
// eventually reach something it shouldn't, and defeats the whole point of
// decomposing to primitives at the boundary.
```

Every bridge function wired into a module's context corresponds to
exactly one manifest-declared, user-approved capability (`docs/SPEC.md`
Section 10.3's table: `render`, `audio`, `storage:local`,
`storage:global`, `network`, `input:raw`, `clipboard`,
`player-identity`). A module that declared only `render` and `audio`
gets a context with only those bridge functions defined — everything
else is simply absent from its global scope, not present-but-checked.
Absence is the enforcement mechanism, not a runtime permission check
inside a universally-available function.

### 4.1 `network` gets extra scrutiny

Per `docs/SPEC.md` Section 10.3's own callout, `network` is the
dangerous capability. The bridge function for it validates the
requested URL's origin against the manifest's declared allowlist
*on the host side, before the fetch happens* — the CSP `connect-src`
header is the second, independent layer (defense in depth: a bug in the
bridge's allowlist check doesn't become a full SSRF-via-module bypass if
the browser's own CSP still blocks the request).

## 5. Compute and memory budgets

- **Compute**: `runtime.setInterruptHandler()` with a time-based deadline
  per fixed-step tick (informed by Section 2.1's measurement — thousands
  of interrupt-handler calls per 200ms means a per-tick budget in the
  hundreds of microseconds to low milliseconds is enforceable at real
  granularity, not just in theory). A module that exceeds budget on a
  given tick is suspended for that tick and the overage is reported
  (attributed by module name, per `docs/SPEC.md` Section 9.4's profiler
  requirement for interceptors — the same attribution discipline applies
  here), not silently absorbed and not allowed to freeze the frame loop.
- **Memory**: `runtime.setMemoryLimit()` per module instance. The exact
  byte budget is a tuning question for implementation (informed by
  `docs/SPEC.md` Section 18's per-module frame-cost budgets, which this
  document doesn't set numbers for) — the mechanism itself is confirmed
  functional in Section 2.1.
- **Stack**: `runtime.setMaxStackSize()`, guards against a module that
  recurses itself into a native stack overflow rather than an
  interpreter-visible error.

## 6. `Eval` inside the guest realm is not a CLAUDE.md guardrail-2 violation

Worth stating explicitly since it looks contradictory at a glance:
`quickjs-emscripten`'s default `Intrinsics` include `Eval: true` — the
QuickJS-interpreted code can call its own `eval()`. CLAUDE.md guardrail 2
("never use eval... anywhere in the editor or API... the runtime sandbox
is the only place code is evaluated") is exactly carving out this case —
the guardrail is about the *host* JS engine (editor, API process) never
calling `eval`/`new Function` on anything, not about the sandboxed guest
interpreter's own self-contained `eval`. A module calling `eval()` on its
own string just runs more QuickJS-interpreted bytecode, fully contained
by the same boundary as everything else it does — no different in risk
from the module's original source. This intrinsic stays enabled.

## 7. Hostile fixture checklist (drives `sandbox-escape.test.ts`, Phase 5)

Each of these needs a fixture module and an assertion that it fails to
achieve its goal, cleanly (a catchable error or a suspended/terminated
module — never a hung tab, a host-process crash, or successful escape):

- [ ] Realm-escape via `Function` constructor chain (`({}).constructor.constructor(...)`) — spot-checked in Section 2.1, needs a permanent regression test
- [ ] Realm-escape via `Object.getPrototypeOf` chains reaching toward a host-injected object
- [ ] Prototype pollution of built-ins (`Object.prototype`, `Array.prototype`) attempting to affect the host realm or a sibling module's realm
- [ ] Infinite loop / compute exhaustion (`while(true){}`, deeply recursive function, exponential regex backtracking) — spot-checked in Section 2.1, needs a permanent regression test
- [ ] Memory exhaustion (allocation bomb) — spot-checked in Section 2.1, needs a permanent regression test
- [ ] Calling a capability function the module's manifest did not declare (should not exist in scope at all)
- [ ] Calling a declared capability with out-of-range/malformed arguments (bridge function must validate, not trust)
- [ ] `network` capability requesting a domain outside the manifest's allowlist
- [ ] Attempting to reach another module's runtime/context (two Workers, two runtimes — should be structurally impossible, but assert it)
- [ ] Timing-based side-channel probing (measuring interrupt-handler cadence to infer host state) — low severity, worth one fixture to document the residual risk rather than silently ignoring it
- [ ] Worker termination / cleanup: a module that gets suspended for budget overage does not leave the Worker in a state that leaks memory or blocks the next tick

## 8. Residual risk not resolved by this design

- `quickjs-emscripten` itself is unaudited (Section 2.1) — carried by
  Risk R3's external-audit requirement before Phase 3, not by anything
  built in M2.
- The `SharedArrayBuffer` ECS fast-path mentioned as a mitigation in
  `docs/SPEC.md` Section 10.2 is **not** part of this design and is not
  being built in M2. It would reintroduce a shared-memory channel
  between host and guest, which needs its own dedicated adversarial
  review before it's added — the message-passing bridge in Section 4 is
  the only channel M2 builds.
- Browser/WASM-engine-level bugs (a V8 or WASM runtime vulnerability) are
  out of scope for an application-level design document; they're the
  browser vendor's responsibility and no application-layer mitigation
  changes that.
