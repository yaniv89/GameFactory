using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace Forge.Functions.Build;

/// <summary>
/// docs/adr/0010 Decision 4's actual schedule. Everything this method
/// does beyond DI resolution is one call into
/// <see cref="BuildOrchestrator.BuildNextAsync"/>, which
/// services/Forge.Tests/Features/Builds/BuildOrchestratorTests.cs already
/// exercises end to end — the trigger binding itself is the one thing
/// that couldn't be verified any way other than a real CI build (see
/// Forge.Functions.Build.csproj's own remarks on why).
/// </summary>
public sealed class BuildQueuedBuildsFunction(BuildOrchestrator orchestrator, ILogger<BuildQueuedBuildsFunction> logger)
{
    // Bounded, not "drain everything queued": one invocation working
    // through an unbounded backlog risks running past the Functions
    // host's own execution-time limits — each build can take up to
    // BuildRunnerOptions.TimeoutSeconds on its own, and those add up
    // fast. Whatever's left over just waits for the next tick, same
    // reasoning as ScanPendingVersionsFunction's own MaxPerInvocation.
    private const int MaxPerInvocation = 3;

    [Function("BuildQueuedBuilds")]
    public async Task RunAsync([TimerTrigger("*/30 * * * * *")] TimerInfo timer, CancellationToken ct)
    {
        for (var i = 0; i < MaxPerInvocation; i++)
        {
            bool built;
            try
            {
                built = await orchestrator.BuildNextAsync(ct);
            }
            catch (BuildHarnessException ex)
            {
                // A harness failure (the CLI process failed to start,
                // produced no index.html, or exceeded the hard timeout)
                // says nothing about whether the claimed project is
                // buildable — BuildOrchestrator has already requeued it
                // rather than writing a false Failed verdict. Logged with
                // full context (CLAUDE.md Section 1.1 guardrail 11), and
                // this invocation stops rather than repeatedly hammering
                // whatever infrastructure problem just surfaced.
                logger.LogError(ex, "Build harness failure — stopping this invocation's batch early.");
                return;
            }

            if (!built) return; // Nothing left queued.
        }
    }
}
