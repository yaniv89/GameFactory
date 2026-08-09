import { describe, expect, it } from "vitest";
import { runModuleSmokeTest } from "../src/smoke/smokeRunner";

const BASE_OPTIONS = {
  moduleName: "smoke-test-module",
  version: "1.0.0",
  engineVersion: "0.0.0-test",
};

describe("runModuleSmokeTest: docs/SPEC.md Section 10.4 gate 4", () => {
  it("a benign module completes every requested tick and passes", async () => {
    const report = await runModuleSmokeTest({
      ...BASE_OPTIONS,
      ticks: 20,
      bundleSource: `
        (function () {
          function setup(ctx) {
            ctx.addSystem({
              id: "move",
              phase: "Update",
              query: ["Transform", "Velocity"],
              run: function (tctx, entities) {
                entities.forEach(function (id) {
                  var t = tctx.world.get(id, "Transform");
                  var v = tctx.world.get(id, "Velocity");
                  tctx.world.set(id, "Transform", { x: t.x + v.vx * tctx.dt, y: t.y + v.vy * tctx.dt });
                });
              }
            });
          }
          __forge_registerModule({ setup: setup });
        })();
      `,
    });

    expect(report.verdict).toBe("passed");
    expect(report.crashed).toBe(false);
    expect(report.ticksCompleted).toBe(20);
    expect(report.ticksRequested).toBe(20);
    expect(report.error).toBeUndefined();
    expect(report.budget.maxTickMs).toBeGreaterThanOrEqual(0);
  });

  it("defaults to 600 ticks (docs/SPEC.md Section 10.4)", async () => {
    const report = await runModuleSmokeTest({
      ...BASE_OPTIONS,
      bundleSource: `(function () { __forge_registerModule({ setup: function () {} }); })();`,
    });

    expect(report.ticksRequested).toBe(600);
    expect(report.ticksCompleted).toBe(600);
    expect(report.verdict).toBe("passed");
  });

  it("a module whose setup() throws is blocked, not crashed", async () => {
    const report = await runModuleSmokeTest({
      ...BASE_OPTIONS,
      ticks: 10,
      bundleSource: `
        (function () {
          function setup(ctx) { throw new Error("bad config"); }
          __forge_registerModule({ setup: setup });
        })();
      `,
    });

    expect(report.verdict).toBe("blocked");
    expect(report.crashed).toBe(false);
    expect(report.ticksCompleted).toBe(0);
    expect(report.error?.phase).toBe("setup");
    expect(report.error?.message).toContain("bad config");
  });

  it("a module that never calls __forge_registerModule is blocked", async () => {
    const report = await runModuleSmokeTest({
      ...BASE_OPTIONS,
      ticks: 10,
      bundleSource: `(function () { /* forgot to register */ })();`,
    });

    expect(report.verdict).toBe("blocked");
    expect(report.crashed).toBe(false);
    expect(report.error?.message).toMatch(/did not call __forge_registerModule/);
  });

  it("a module whose setup() overflows the host's native stack is blocked and reported as crashed", async () => {
    // Same fixture docs/security/SANDBOX-DESIGN.md Section 2.1 and
    // sandbox-escape.test.ts already verify actually crashes the
    // underlying ModuleRuntime (a host-level exception, not a normal
    // guest-level throw).
    const report = await runModuleSmokeTest({
      ...BASE_OPTIONS,
      ticks: 10,
      bundleSource: `
        (function () {
          function setup(ctx) {
            function recurse(n) { return recurse(n + 1); }
            recurse(0);
          }
          __forge_registerModule({ setup: setup });
        })();
      `,
    });

    expect(report.verdict).toBe("blocked");
    expect(report.crashed).toBe(true);
    expect(report.error?.phase).toBe("setup");
  });

  it("a system stuck in an infinite loop is interrupted, measured, and does NOT block the run (the compute budget bounding it is the point, not a failure)", async () => {
    const report = await runModuleSmokeTest({
      ...BASE_OPTIONS,
      ticks: 3,
      computeBudgetMs: 50,
      bundleSource: `
        (function () {
          function setup(ctx) {
            ctx.addSystem({
              id: "hang",
              phase: "Update",
              query: ["Transform"],
              skipIfEmpty: false,
              run: function () { while (true) {} }
            });
          }
          __forge_registerModule({ setup: setup });
        })();
      `,
    });

    expect(report.verdict).toBe("passed");
    expect(report.crashed).toBe(false);
    expect(report.ticksCompleted).toBe(3);
    expect(report.budget.maxTickMs).toBeGreaterThan(0);
  });

  it("a module that never grants itself network access has no fetch capability, even if it declares one via config", async () => {
    const report = await runModuleSmokeTest({
      ...BASE_OPTIONS,
      ticks: 1,
      bundleSource: `
        (function () {
          function setup(ctx) {
            if (ctx.net !== undefined) throw new Error("net should be undefined without networkAllowedOrigins");
          }
          __forge_registerModule({ setup: setup });
        })();
      `,
    });

    expect(report.verdict).toBe("passed");
  });
});
