using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace Forge.Functions.ArtGen;

/// <summary>
/// docs/adr/0016 Decision 2's actual schedule. Everything this method
/// does beyond DI resolution is one call into
/// <see cref="ArtGenOrchestrator.ProcessNextAsync"/>, which
/// services/Forge.Tests/Features/ArtGeneration/ArtGenOrchestratorTests.cs
/// already exercises end to end — the trigger binding itself is the one
/// thing that couldn't be verified any way other than a real CI build
/// (see Forge.Functions.ArtGen.csproj's own remarks on why).
/// </summary>
public sealed class ArtGenProcessQueuedFunction(ArtGenOrchestrator orchestrator, ILogger<ArtGenProcessQueuedFunction> logger)
{
    // Bounded, not "drain everything queued" -- same reasoning as
    // AssetProcessQueuedAssetsFunction's own MaxPerInvocation, set lower
    // here since a real Gemini image-generation call is far slower (and
    // costlier) than an in-process image decode.
    private const int MaxPerInvocation = 3;

    [Function("ArtGenProcessQueued")]
    public async Task RunAsync([TimerTrigger("*/30 * * * * *")] TimerInfo timer, CancellationToken ct)
    {
        for (var i = 0; i < MaxPerInvocation; i++)
        {
            bool processed;
            try
            {
                processed = await orchestrator.ProcessNextAsync(ct);
            }
            catch (ArtGenHarnessException ex)
            {
                // A harness failure (Gemini call failed, variation upload
                // failed) says nothing about whether the claimed request
                // is processable -- ArtGenOrchestrator has already
                // requeued it rather than writing a false Failed
                // verdict. Logged with full context (CLAUDE.md Section
                // 1.1 guardrail 11), and this invocation stops rather
                // than repeatedly hammering whatever infrastructure
                // problem (or provider outage) just surfaced.
                logger.LogError(ex, "Art generation harness failure — stopping this invocation's batch early.");
                return;
            }

            if (!processed) return; // Nothing left queued.
        }
    }
}
