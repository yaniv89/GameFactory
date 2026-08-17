using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace Forge.Infrastructure.Storage;

public sealed class AzureBlobAssetStorage(BlobContainerClient quarantineContainer, BlobContainerClient publicContainer) : IAssetStorage
{
    public async Task UploadOriginalAsync(Guid workspaceId, Guid assetId, byte[] originalBytes, CancellationToken ct)
    {
        var blob = quarantineContainer.GetBlobClient(OriginalPath(workspaceId, assetId));
        using var stream = new MemoryStream(originalBytes, writable: false);
        // No HttpHeaders.ContentType here, deliberately: this container is
        // never read back through a public HTTP response (docs/adr/0012
        // Decision 6/7) — the only reader is Forge.Functions.Assets's own
        // DownloadOriginalAsync, which needs the bytes, not a header a
        // browser would trust.
        await blob.UploadAsync(stream, overwrite: true, ct);
    }

    public async Task<byte[]> DownloadOriginalAsync(Guid workspaceId, Guid assetId, CancellationToken ct)
    {
        var blob = quarantineContainer.GetBlobClient(OriginalPath(workspaceId, assetId));
        try
        {
            var result = await blob.DownloadContentAsync(ct);
            return result.Value.Content.ToArray();
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            throw new AssetOriginalNotFoundException(assetId);
        }
    }

    public async Task UploadProcessedAsync(Guid workspaceId, Guid assetId, byte[] processedPngBytes, CancellationToken ct)
    {
        var blob = publicContainer.GetBlobClient(ProcessedPath(workspaceId, assetId));
        using var stream = new MemoryStream(processedPngBytes, writable: false);
        await blob.UploadAsync(
            stream,
            new BlobUploadOptions { HttpHeaders = new BlobHttpHeaders { ContentType = "image/png" } },
            ct);
    }

    public async Task DeleteAsync(Guid workspaceId, Guid assetId, CancellationToken ct)
    {
        await quarantineContainer.GetBlobClient(OriginalPath(workspaceId, assetId)).DeleteIfExistsAsync(cancellationToken: ct);
        await publicContainer.GetBlobClient(ProcessedPath(workspaceId, assetId)).DeleteIfExistsAsync(cancellationToken: ct);
    }

    private static string OriginalPath(Guid workspaceId, Guid assetId) => $"{workspaceId}/{assetId}/original";
    private static string ProcessedPath(Guid workspaceId, Guid assetId) => $"{workspaceId}/{assetId}/opt.png";
}
