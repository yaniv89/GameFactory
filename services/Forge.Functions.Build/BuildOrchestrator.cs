using System.Security.Cryptography;
using Forge.Infrastructure.Storage;

namespace Forge.Functions.Build;

/// <summary>
/// Wires <see cref="BuildScanner"/> (claim/complete against <c>builds</c>),
/// <see cref="BuildRunner"/> (run the real <c>forge export</c> CLI in the
/// real sandboxed-by-the-OS subprocess sense) and <see cref="IBuildBundleStorage"/>
/// (upload the real result) into docs/adr/0010 Decision 4's actual
/// per-build workflow — the same shape <c>Forge.Functions.Scan.ScanOrchestrator</c>
/// already established for gate 4. The Azure Functions Worker trigger
/// that calls <see cref="BuildNextAsync"/> on a schedule doesn't exist
/// here either — see <c>Forge.Functions.Build.csproj</c>'s own comment
/// for why that's deliberately a separate, later change — but this class
/// is the whole real worker, independently callable and tested without it.
/// </summary>
public sealed class BuildOrchestrator(BuildScanner scanner, BuildRunner runner, IBuildBundleStorage bundleStorage)
{
    /// <summary>Claims and builds one queued build, if any is available. Returns false when there was nothing to claim — the caller (a timer trigger) treats that as "nothing to do this tick," not an error.</summary>
    public async Task<bool> BuildNextAsync(CancellationToken ct)
    {
        var claimed = await scanner.ClaimNextAsync(ct);
        if (claimed is null) return false;

        var document = await scanner.GetRevisionDocumentAsync(claimed.RevisionId, ct);

        try
        {
            var artifact = await runner.RunAsync(new BuildRunRequest(claimed.ProjectId, document), ct);

            var bundleSha256 = SHA256.HashData(artifact.IndexHtmlBytes);
            await bundleStorage.UploadAsync(
                claimed.Id,
                artifact.IndexHtmlBytes,
                new BuildBundleMetadata(artifact.InlineScriptSha256Base64, artifact.InlineStyleSha256Base64),
                ct);

            await scanner.MarkReadyAsync(
                claimed.Id,
                bundleBlobPath: $"builds/{claimed.Id}/index.html",
                bundleSha256: bundleSha256,
                sizeBytes: artifact.IndexHtmlBytes.LongLength,
                inlineScriptSha256Base64: artifact.InlineScriptSha256Base64,
                inlineStyleSha256Base64: artifact.InlineStyleSha256Base64,
                ct);
        }
        catch (BuildFailedException ex)
        {
            await scanner.MarkFailedAsync(claimed.Id, ex.Message, ct);
        }
        catch (BuildHarnessException)
        {
            // Requeue, don't rethrow: a caller polling in a loop (as
            // BuildOrchestratorTests and any real batch-processing
            // caller both do) needs to be able to move on to the next
            // claimable build rather than the whole batch dying on one
            // instance's environment problem. The timer trigger function
            // is what actually decides whether to stop this tick's batch
            // early and log — same split ScanPendingVersionsFunction
            // uses for SmokeGateHarnessException.
            await scanner.RequeueAsync(claimed.Id, ct);
            throw;
        }

        return true;
    }
}
