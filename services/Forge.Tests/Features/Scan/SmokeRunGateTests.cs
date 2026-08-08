using Forge.Functions.Scan.SmokeGate;
using Xunit;

namespace Forge.Tests.Features.Scan;

/// <summary>
/// Exercises <see cref="SmokeRunGate"/> against the real, built
/// packages/runtime-host smoke-run CLI (docs/SPEC.md Section 10.4 gate
/// 4) — not a stub standing in for it, so a real regression in either
/// side of the JSON-over-stdio contract (packages/runtime-host/src/smoke/cli.ts
/// and this class) would actually be caught here.
///
/// Requires <c>pnpm --filter @forge/runtime-host... run build</c> to have
/// already produced <c>packages/runtime-host/dist/smoke/cli.bundle.mjs</c>
/// before this test class runs — wired into the .NET CI job specifically
/// for this (see .github/workflows/ci.yml's dotnet-build-test job).
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class SmokeRunGateTests
{
    private static SmokeGateOptions Options(int timeoutSeconds = 60) => new()
    {
        CliBundlePath = RepoPaths.Resolve("packages/runtime-host/dist/smoke/cli.bundle.mjs"),
        TimeoutSeconds = timeoutSeconds,
    };

    private static SmokeRunRequest Request(string bundleSource, int ticks = 5, int? computeBudgetMs = null) => new()
    {
        ModuleName = "smoke-gate-test",
        Version = "1.0.0",
        EngineVersion = "0.0.0-test",
        BundleSource = bundleSource,
        Ticks = ticks,
        ComputeBudgetMs = computeBudgetMs,
    };

    [Fact]
    public async Task A_Benign_Module_Passes()
    {
        var gate = new SmokeRunGate(Options());
        var report = await gate.RunAsync(
            Request("(function () { __forge_registerModule({ setup: function () {} }); })();"),
            CancellationToken.None);

        Assert.Equal("passed", report.Verdict);
        Assert.False(report.Crashed);
        Assert.Equal(5, report.TicksCompleted);
        Assert.Null(report.Error);
    }

    [Fact]
    public async Task A_Module_Whose_Setup_Throws_Is_Blocked_Not_A_Harness_Failure()
    {
        var gate = new SmokeRunGate(Options());
        var report = await gate.RunAsync(
            Request("(function () { function setup() { throw new Error('bad config'); } __forge_registerModule({ setup: setup }); })();"),
            CancellationToken.None);

        Assert.Equal("blocked", report.Verdict);
        Assert.False(report.Crashed);
        Assert.NotNull(report.Error);
        Assert.Equal("setup", report.Error!.Phase);
        Assert.Contains("bad config", report.Error.Message);
    }

    [Fact]
    public async Task A_Module_That_Overflows_The_Host_Stack_Is_Blocked_And_Crashed()
    {
        var gate = new SmokeRunGate(Options());
        var report = await gate.RunAsync(
            Request("(function () { function setup() { function r(n) { return r(n + 1); } r(0); } __forge_registerModule({ setup: setup }); })();"),
            CancellationToken.None);

        Assert.Equal("blocked", report.Verdict);
        Assert.True(report.Crashed);
    }

    [Fact]
    public async Task A_Run_That_Exceeds_The_Hard_Timeout_Is_A_Harness_Failure_Not_A_Verdict()
    {
        // computeBudgetMs is well beyond the gate's own timeout, so the
        // sandbox's own interrupt handler never gets a chance to fire
        // first — this is exercising SmokeRunGate's own kill-on-timeout
        // path, not the sandbox's per-call compute budget.
        var gate = new SmokeRunGate(Options(timeoutSeconds: 1));
        var request = Request(
            "(function () { function setup() { while (true) {} } __forge_registerModule({ setup: setup }); })();",
            ticks: 1,
            computeBudgetMs: 60_000);

        var ex = await Assert.ThrowsAsync<SmokeGateHarnessException>(() => gate.RunAsync(request, CancellationToken.None));
        Assert.Contains("timeout", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_Missing_Node_Executable_Is_A_Harness_Failure()
    {
        var gate = new SmokeRunGate(Options() with { NodeExecutablePath = "definitely-not-a-real-executable-forge-test" });
        var ex = await Assert.ThrowsAsync<SmokeGateHarnessException>(
            () => gate.RunAsync(Request("(function () { __forge_registerModule({ setup: function () {} }); })();"), CancellationToken.None));
        Assert.Contains("Failed to start", ex.Message);
    }
}
