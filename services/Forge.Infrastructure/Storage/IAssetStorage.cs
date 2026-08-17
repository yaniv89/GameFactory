namespace Forge.Infrastructure.Storage;

/// <summary>
/// docs/adr/0012 Decision 6's two-container Blob layout: a private
/// <c>assets-quarantine</c> container holding exactly what a creator
/// uploaded, untouched and undecoded, and a separate public <c>assets</c>
/// container holding only bytes <c>Forge.Functions.Assets</c> itself
/// re-encoded from decoded pixel data. One interface, two callers:
/// <c>Forge.Api</c> (uploads to quarantine, deletes both on
/// <c>DELETE /api/v1/assets/{id}</c>) and, from E3 on,
/// <c>Forge.Functions.Assets</c> (reads quarantine, writes the public
/// container). Deliberately not two interfaces split along that caller
/// boundary — the two containers are one asset's two-stage lifecycle, not
/// two independent subsystems, and every method here is meaningful from
/// either process.
/// </summary>
public interface IAssetStorage
{
    /// <summary>Uploads the original, undecoded bytes a creator submitted to the private quarantine container at <c>{workspaceId}/{assetId}/original</c>. The only writer is <c>Forge.Api</c>'s upload endpoint; the only reader is <c>Forge.Functions.Assets</c>.</summary>
    Task UploadOriginalAsync(Guid workspaceId, Guid assetId, byte[] originalBytes, CancellationToken ct);

    /// <summary>Reads back the quarantined original bytes — <c>Forge.Functions.Assets</c>'s own input for the one real decode this pipeline ever does.</summary>
    Task<byte[]> DownloadOriginalAsync(Guid workspaceId, Guid assetId, CancellationToken ct);

    /// <summary>Uploads the re-encoded PNG <c>Forge.Functions.Assets</c> produced from decoded pixel data to the public <c>assets</c> container at <c>{workspaceId}/{assetId}/opt.png</c> — never the uploaded bytes, never a copy of them (docs/adr/0012 Decision 4).</summary>
    Task UploadProcessedAsync(Guid workspaceId, Guid assetId, byte[] processedPngBytes, CancellationToken ct);

    /// <summary>Deletes both the quarantine and (if present) public blobs for an asset — <c>DELETE /api/v1/assets/{id}</c>'s own storage-layer half. Deleting a blob that doesn't exist (a <see cref="Domain.Entities.AssetStatus.Pending"/> or <see cref="Domain.Entities.AssetStatus.Failed"/> row never got a processed blob) is a no-op, not an error.</summary>
    Task DeleteAsync(Guid workspaceId, Guid assetId, CancellationToken ct);
}

/// <summary>Thrown by <see cref="IAssetStorage.DownloadOriginalAsync"/> when the target asset has no quarantined content — an asset id that was never uploaded, or whose quarantine blob was already deleted.</summary>
public sealed class AssetOriginalNotFoundException(Guid assetId)
    : Exception($"No quarantined original found for asset '{assetId}'.");
