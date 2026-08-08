using Forge.Functions.Scan.SmokeGate;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace Forge.Functions.Scan;

/// <summary>
/// docs/SPEC.md Section 10.4 gate 4's actual schedule. Everything this
/// method does beyond DI resolution is one call into
/// <see cref="ScanOrchestrator.ScanNextAsync"/>, which
/// services/Forge.Tests/Features/Scan/ScanOrchestratorTests.cs already
/// exercises end to end — the trigger binding itself is the one thing
/// that couldn't be verified any way other than a real CI build (see
/// Forge.Functions.Scan.csproj's own remarks on why).
/// </summary>
public sealed class ScanPendingVersionsFunction(ScanOrchestrator orchestrator, ILogger<ScanPendingVersionsFunction> logger)
{
    // A bounded batch, not "drain everything pending": one invocation
    // working through an unbounded backlog risks running past the
    // Functions host's own execution-time limits — each scan can take up
    // to SmokeGateOptions.TimeoutSeconds on its own (docs/SPEC.md Section
    // 10.4's hard 60s cap), and those add up fast. Whatever's left over
    // just waits for the next tick instead of blocking this one.
    private const int MaxPerInvocation = 5;

    [Function("ScanPendingVersions")]
    public async Task RunAsync([TimerTrigger("*/30 * * * * *")] TimerInfo timer, CancellationToken ct)
    {
        for (var i = 0; i < MaxPerInvocation; i++)
        {
            bool scanned;
            try
            {
                scanned = await orchestrator.ScanNextAsync(ct);
            }
            catch (SmokeGateHarnessException ex)
            {
                // A harness failure (the CLI process failed to start,
                // produced unparseable output, or exceeded the hard
                // timeout) says nothing about whether the claimed
                // version is safe — PendingVersionScanner's own remarks
                // already document that it stays Scanning rather than
                // getting written into ScanStatus as a false verdict.
                // Logged with full context (CLAUDE.md Section 1.1
                // guardrail 11), and this invocation stops rather than
                // repeatedly hammering whatever infrastructure problem
                // just surfaced.
                logger.LogError(ex, "Gate 4 smoke-run harness failure — stopping this invocation's batch early.");
                return;
            }

            if (!scanned) return; // Nothing left pending.
        }
    }
}
