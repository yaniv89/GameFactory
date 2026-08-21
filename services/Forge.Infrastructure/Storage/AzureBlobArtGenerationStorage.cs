using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace Forge.Infrastructure.Storage;

public sealed class AzureBlobArtGenerationStorage(BlobContainerClient container) : IArtGenerationStorage
{
    public async Task UploadVariationAsync(Guid workspaceId, Guid generationRequestId, Guid variationId, byte[] pngBytes, CancellationToken ct)
    {
        var blob = container.GetBlobClient(Path(workspaceId, generationRequestId, variationId));
        using var stream = new MemoryStream(pngBytes, writable: false);
        await blob.UploadAsync(
            stream,
            new BlobUploadOptions { HttpHeaders = new BlobHttpHeaders { ContentType = "image/png" } },
            ct);
    }

    public async Task<byte[]> DownloadVariationAsync(Guid workspaceId, Guid generationRequestId, Guid variationId, CancellationToken ct)
    {
        var blob = container.GetBlobClient(Path(workspaceId, generationRequestId, variationId));
        try
        {
            var result = await blob.DownloadContentAsync(ct);
            return result.Value.Content.ToArray();
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            throw new ArtGenerationVariationNotFoundException(variationId);
        }
    }

    private static string Path(Guid workspaceId, Guid generationRequestId, Guid variationId) =>
        $"{workspaceId}/{generationRequestId}/{variationId}.png";
}
