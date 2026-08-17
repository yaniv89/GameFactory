using Forge.Infrastructure.Storage;

namespace Forge.Functions.Assets;

/// <summary>
/// Wires <see cref="AssetScanner"/> (claim/complete against <c>assets</c>),
/// <see cref="AssetRunner"/> (the real decode/re-encode) and
/// <see cref="IAssetStorage"/> (download the quarantined original, upload
/// the re-encoded result) into docs/adr/0012 Decision 4's actual
/// per-asset workflow — the same shape
/// <c>Forge.Functions.Build.BuildOrchestrator</c> already established for
/// C3. The Azure Functions Worker trigger that calls
/// <see cref="ProcessNextAsync"/> on a schedule doesn't exist here either
/// — see <c>Forge.Functions.Assets.csproj</c>'s own comment for why
/// that's deliberately a separate, later concern — but this class is the
/// whole real worker, independently callable and tested without it.
/// </summary>
public sealed class AssetOrchestrator(AssetScanner scanner, AssetRunner runner, IAssetStorage storage)
{
    /// <summary>Claims and processes one pending asset, if any is available. Returns false when there was nothing to claim — the caller (a timer trigger) treats that as "nothing to do this tick," not an error.</summary>
    public async Task<bool> ProcessNextAsync(CancellationToken ct)
    {
        var claimed = await scanner.ClaimNextAsync(ct);
        if (claimed is null) return false;

        try
        {
            byte[] originalBytes;
            try
            {
                originalBytes = await storage.DownloadOriginalAsync(claimed.WorkspaceId, claimed.Id, ct);
            }
            catch (AssetOriginalNotFoundException ex)
            {
                // The row was claimable (Status == Pending) but its
                // quarantine blob is gone — an infra/consistency problem
                // this worker instance hit, not a verdict on a file it
                // never actually got to look at.
                throw new AssetHarnessException($"No quarantined original found for asset '{claimed.Id}'.", ex);
            }

            var artifact = runner.Run(new AssetRunRequest(originalBytes));

            await storage.UploadProcessedAsync(claimed.WorkspaceId, claimed.Id, artifact.PngBytes, ct);

            await scanner.MarkReadyAsync(
                claimed.Id,
                processedBlobPath: $"{claimed.WorkspaceId}/{claimed.Id}/opt.png",
                width: artifact.Width,
                height: artifact.Height,
                ct);
        }
        catch (AssetProcessingFailedException ex)
        {
            await scanner.MarkFailedAsync(claimed.Id, ex.Message, ct);
        }
        catch (AssetHarnessException)
        {
            // Requeue, don't rethrow: a caller polling in a loop (as
            // AssetOrchestratorTests and any real batch-processing caller
            // both do) needs to be able to move on to the next claimable
            // asset rather than the whole batch dying on one instance's
            // environment problem. Same split BuildOrchestrator uses for
            // BuildHarnessException.
            await scanner.RequeueAsync(claimed.Id, ct);
            throw;
        }

        return true;
    }
}
