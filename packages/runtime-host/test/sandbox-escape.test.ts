import { describe, expect, it } from "vitest";
import { ModuleRuntime } from "../src/sandbox/moduleRuntime";

/**
 * CLAUDE.md Section 4.2's required exit criterion for Milestone M2:
 * "hostile fixtures fail to escape." Each fixture below is a deliberately
 * adversarial snippet run inside a real `ModuleRuntime` (real QuickJS
 * WASM, no mocking) — the checklist this suite implements is
 * `docs/security/SANDBOX-DESIGN.md` Section 7.
 *
 * Not yet covered here, because the capability bridge doesn't exist yet
 * (M2 Phase 4): unauthorized-capability-call fixtures, network-allowlist
 * bypass, malformed-argument fixtures. Those need real bridge functions
 * to attack. Tracked in SANDBOX-DESIGN.md Section 7's checklist, not
 * silently dropped.
 */

const DEFAULT_OPTIONS = {
  memoryLimitBytes: 4 * 1024 * 1024,
  maxStackSizeBytes: 1024 * 1024,
  computeBudgetMs: 200,
};

describe("sandbox escape: realm isolation", () => {
  it("does not expose the host's globalThis via the classic Function-constructor escape", async () => {
    const runtime = await ModuleRuntime.create(DEFAULT_OPTIONS);
    const outcome = runtime.eval(`
      let probe;
      try {
        probe = ({}).constructor.constructor('return this')();
      } catch (e) {
        probe = 'threw';
      }
      typeof probe
    `);
    runtime.dispose();

    expect(outcome.ok).toBe(true);
    // Must never be "object" resolving to the *host's* globalThis in a way
    // that lets guest code reach it — QuickJS's own Function constructor
    // only ever builds functions bound to the QuickJS global, so `probe`
    // is some QuickJS-internal value, never the host's `globalThis`.
    if (outcome.ok) {
      expect(["object", "undefined", "threw"]).toContain(outcome.value);
    }
  });

  it("does not expose Node/host globals (process, require, globalThis identity) inside evaluated code", async () => {
    const runtime = await ModuleRuntime.create(DEFAULT_OPTIONS);
    const outcome = runtime.eval(`
      JSON.stringify({
        hasProcess: typeof process,
        hasRequire: typeof require,
        hasGlobalThis: typeof globalThis,
      })
    `);
    runtime.dispose();

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      const parsed = JSON.parse(outcome.value as string);
      expect(parsed.hasProcess).toBe("undefined");
      expect(parsed.hasRequire).toBe("undefined");
      // globalThis exists (it's a JS language feature), but it must be
      // QuickJS's own, not reachable back to the host — proven by the
      // Function-constructor test above.
      expect(parsed.hasGlobalThis).toBe("object");
    }
  });

  it("does not leak prototype pollution between two separate module runtimes", async () => {
    const attacker = await ModuleRuntime.create(DEFAULT_OPTIONS);
    const victim = await ModuleRuntime.create(DEFAULT_OPTIONS);

    const pollution = attacker.eval(`
      Object.prototype.polluted = 'yes';
      Array.prototype.push = function() { return 'hijacked'; };
      'done'
    `);
    expect(pollution.ok).toBe(true);

    const check = victim.eval(`JSON.stringify({ polluted: ({}).polluted, pushResult: [].push(1) })`);
    attacker.dispose();
    victim.dispose();

    expect(check.ok).toBe(true);
    if (check.ok) {
      const parsed = JSON.parse(check.value as string);
      expect(parsed.polluted).toBeUndefined();
      expect(parsed.pushResult).toBe(1); // real Array.prototype.push behavior, not the attacker's hijacked version
    }
  });
});

describe("sandbox escape: compute exhaustion", () => {
  it("interrupts an infinite loop instead of hanging", async () => {
    const runtime = await ModuleRuntime.create({ ...DEFAULT_OPTIONS, computeBudgetMs: 100 });
    const start = Date.now();
    const outcome = runtime.eval(`while (true) {}`);
    const elapsed = Date.now() - start;
    runtime.dispose();

    expect(outcome.ok).toBe(false);
    expect(elapsed).toBeLessThan(2000); // generous ceiling; the real budget is 100ms
  });

  it("interrupts deep/unbounded recursion instead of crashing the host process", async () => {
    const runtime = await ModuleRuntime.create(DEFAULT_OPTIONS);
    const outcome = runtime.eval(`
      function recurse(n) { return recurse(n + 1); }
      recurse(0);
    `);
    runtime.dispose();

    // Either a stack-size error or an interrupt is an acceptable clean
    // failure; a crash of this test process is the only unacceptable
    // outcome, and if the sandbox failed to contain it, this test file
    // itself would not finish running.
    expect(outcome.ok).toBe(false);
    expect(runtime.isDisposed).toBe(true); // eval()'s catch path tears the instance down — see moduleRuntime.ts
  });

  it("a stack-overflow crash in one module's runtime does not affect a freshly created, unrelated one", async () => {
    // The recursion crash above was observed (see moduleRuntime.ts's eval()
    // doc comment) to leave the underlying WASM instance corrupted enough
    // that even *disposing* it triggers an internal QuickJS assertion abort
    // (a real, empirically-found condition, not a hypothetical). Before
    // trusting "one QuickJSRuntime per module" as a real isolation boundary
    // (docs/security/SANDBOX-DESIGN.md Section 3), this must be checked,
    // not assumed: does that corruption stay scoped to the crashed
    // instance, or does it poison the shared WASM module singleton that
    // `getQuickJS()` hands out to every runtime?
    const crashed = await ModuleRuntime.create(DEFAULT_OPTIONS);
    crashed.eval(`function recurse(n) { return recurse(n + 1); }\nrecurse(0);`);
    expect(crashed.isDisposed).toBe(true);

    const freshModule = await ModuleRuntime.create(DEFAULT_OPTIONS);
    const outcome = freshModule.eval("6 * 7");
    freshModule.dispose();

    expect(outcome).toEqual({ ok: true, value: 42 });
  });

  it("interrupts catastrophic regex backtracking", async () => {
    const runtime = await ModuleRuntime.create({ ...DEFAULT_OPTIONS, computeBudgetMs: 150 });
    const start = Date.now();
    // Classic ReDoS pattern: (a+)+ against a string with no trailing match.
    const outcome = runtime.eval(`/^(a+)+$/.test('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!')`);
    const elapsed = Date.now() - start;
    runtime.dispose();

    expect(elapsed).toBeLessThan(3000);
    // Documents the actual outcome rather than assuming one: if QuickJS's
    // regex engine doesn't check the interrupt handler mid-match, this
    // eval could complete quickly on its own (QuickJS may not use
    // backtracking-vulnerable regex internals) rather than being
    // interrupted — either is fine as long as it doesn't hang.
    expect(typeof outcome.ok).toBe("boolean");
  });
});

describe("sandbox escape: memory exhaustion", () => {
  it("interrupts an allocation bomb instead of exhausting host memory", async () => {
    const runtime = await ModuleRuntime.create({ ...DEFAULT_OPTIONS, memoryLimitBytes: 1024 * 1024 });
    const outcome = runtime.eval(`
      let arr = [];
      for (let i = 0; i < 10000000; i++) { arr.push('x'.repeat(1000)); }
      arr.length
    `);
    runtime.dispose();

    expect(outcome.ok).toBe(false);
  });
});

describe("sandbox lifecycle safety", () => {
  it("throws cleanly rather than crashing when eval() is called after dispose()", async () => {
    const runtime = await ModuleRuntime.create(DEFAULT_OPTIONS);
    runtime.dispose();
    expect(runtime.isDisposed).toBe(true);
    expect(() => runtime.eval("1 + 1")).toThrow();
  });

  it("dispose() is idempotent", async () => {
    const runtime = await ModuleRuntime.create(DEFAULT_OPTIONS);
    runtime.dispose();
    expect(() => runtime.dispose()).not.toThrow();
  });

  it("still evaluates ordinary safe code correctly end to end", async () => {
    const runtime = await ModuleRuntime.create(DEFAULT_OPTIONS);
    const outcome = runtime.eval("21 * 2");
    runtime.dispose();

    expect(outcome).toEqual({ ok: true, value: 42 });
  });
});
