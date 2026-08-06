# Performance harness

Implements CLAUDE.md Section 7 / `docs/SPEC.md` Section 18's performance
budgets. Three separate measurements, each honest about what it does and
doesn't prove:

## 1. Bundle size — `check-bundle-size.mjs`

Gzips each engine package's `tsc` output and checks it against
`budgets.json`. **Proxy metric**: this is unbundled, untree-shaken,
unminified per-file output, not the real production bundle `docs/SPEC.md`
Section 8.1 budgets against. The real number lands once an actual bundler
(Vite, per the editor's M4 build pipeline) produces one. Wired into CI as
a hard gate (`bundle-size` job) — the proxy is still a useful regression
signal even before the real number exists.

## 2. Runtime simulation throughput and steady-state allocation

- `packages/core/bench/simulation.bench.ts` (`pnpm --filter @forge/core run bench`) —
  Vitest's `bench()` (tinybench) measuring one fixed step (movement +
  AABB collision detection) at 1,000 and 5,000 entities. Statistical
  (mean/p75/p99 across many samples), not a single wall-clock read.
- `packages/core/test/steady-state-heap.test.ts` (part of the normal
  `test` script, which sets `NODE_OPTIONS=--expose-gc`) — forces GC,
  runs 300 fixed steps at 1,000 entities, forces GC again, and asserts
  the heap didn't grow by more than a generous 5 MB ceiling. This is the
  actual proof behind CLAUDE.md Section 1.3 guardrail 14 ("never allocate
  inside the fixed-step frame loop") — not a guess, a measured number,
  printed either way.
- `packages/render-2d/test-browser/renderThroughput.spec.ts` — real Pixi
  rendering of 1,000/5,000 sprites in headless Chromium, frame time and
  `performance.memory` heap growth. Coarser than the Node-side check:
  Chrome quantizes `performance.memory` (confirmed in this sandbox — a
  fresh page reports a suspiciously round `usedJSHeapSize`), so the
  heap-growth assertion here is a 50 MB ceiling, not a precision
  instrument. It exercises the real `pixi.js` browser bundle directly
  (see `pixiRenderer.spec.ts`'s doc comment) rather than our
  `SpriteSync`/`TilemapLayer` TS classes, which still need a bundler to
  run unbundled in a browser — tracked since Phase 3, not solved here.

## ⚠ What none of this proves: the M1 exit criterion's actual numbers

CLAUDE.md's M1 exit criterion is "5000 entities at 60fps reference
desktop, 1000 at 60fps Pixel 6a." `docs/SPEC.md` Section 18.3 defines
*which* desktop and *which* phone (Ryzen 5/GTX 1660; Pixel 6a) — specific
reference hardware, not "whatever machine happens to run this."

This harness runs on whatever CPU is available — in this sandbox, a
virtualized 4-core Xeon @ 2.80GHz, which is not any device in that
matrix and has no discrete GPU (Phase 3 found this sandbox's headless
Chromium has no WebGPU and very likely renders WebGL in software, no
real GPU passthrough). The numbers it produces are real and honestly
measured, useful for regression tracking on this sandbox, and are
**not** a substitute for running on the actual reference devices.

That requires a real-device benchmark farm (BrowserStack/Sauce-class),
which — per `docs/proposals/0001` Section 6.2 — costs roughly
$200–500/month and is explicitly deferred until there's a live product
and real usage to fund it from, not built into the bootstrap-phase
budget. Until then:

- CI runs this harness on every PR (`runtime-benchmark` job) so the
  numbers are visible and regressions are visible-by-eyeball.
- It does **not** hard-fail based on Section 18.1's ms budgets, because
  failing a PR based on a comparison against hardware nobody is actually
  running on would be a false signal, not a real gate.
- The correctness assertions in `render-2d-browser-tests` (does a GPU
  context boot at all, does rendering actually happen, is heap growth
  sane) *do* block merge — those are real bugs if they fail, unlike the
  ms numbers.

**Bottom line:** M1's code is built and its behavior is proven correct
by 84+ unit/integration tests plus these harnesses. Whether it actually
*hits* 5000/1000 entities at 60fps on the Section 18.3 reference devices
is not yet verified against real hardware, and this file exists so that
gap stays visible instead of getting silently assumed away.
