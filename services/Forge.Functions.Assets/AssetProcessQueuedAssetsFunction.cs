using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace Forge.Functions.Assets;

/// <summary>
/// docs/adr/0012 Decision 4's actual schedule. Everything this method
/// does beyond DI resolution is one call into
/// <see cref="AssetOrchestrator.ProcessNextAsync"/>, which
/// services/Forge.Tests/Features/Assets/AssetOrchestratorTests.cs already
/// exercises end to end — the trigger binding itself is the one thing
/// that couldn't be verified any way other than a real CI build (see
/// Forge.Functions.Assets.csproj's own remarks on why).
/// </summary>
public sealed class AssetProcessQueuedAssetsFunction(AssetOrchestrator orchestrator, ILogger<AssetProcessQueuedAssetsFunction> logger)
{
    // Bounded, not "drain everything queued": one invocation working
    // through an unbounded backlog risks running past the Functions
    // host's own execution-time limits — same reasoning as
    // BuildQueuedBuildsFunction's own MaxPerInvocation, though set higher
    // here since a single in-process image decode is far cheaper than a
    // vite build subprocess.
    private const int MaxPerInvocation = 10;

    [Function("AssetProcessQueuedAssets")]
    public async Task RunAsync([TimerTrigger("*/15 * * * * *")] TimerInfo timer, CancellationToken ct)
    {
        for (var i = 0; i < MaxPerInvocation; i++)
        {
            bool processed;
            try
            {
                processed = await orchestrator.ProcessNextAsync(ct);
            }
            catch (AssetHarnessException ex)
            {
                // A harness failure (the quarantined original went
                // missing) says nothing about whether the claimed asset
                // is processable — AssetOrchestrator has already
                // requeued it rather than writing a false Failed
                // verdict. Logged with full context (CLAUDE.md Section
                // 1.1 guardrail 11), and this invocation stops rather
                // than repeatedly hammering whatever infrastructure
                // problem just surfaced.
                logger.LogError(ex, "Asset processing harness failure — stopping this invocation's batch early.");
                return;
            }

            if (!processed) return; // Nothing left pending.
        }
    }
}
