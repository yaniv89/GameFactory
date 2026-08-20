using System.Text.Json;
using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace Forge.Infrastructure.Storage;

public sealed class AzureBlobBuildBundleStorage(BlobContainerClient container) : IBuildBundleStorage
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task UploadAsync(Guid buildId, byte[] indexHtml, BuildBundleMetadata metadata, CancellationToken ct)
    {
        var htmlBlob = container.GetBlobClient(IndexHtmlPath(buildId));
        using (var stream = new MemoryStream(indexHtml, writable: false))
        {
            await htmlBlob.UploadAsync(
                stream,
                new BlobUploadOptions { HttpHeaders = new BlobHttpHeaders { ContentType = "text/html" } },
                ct);
        }

        var metaBytes = JsonSerializer.SerializeToUtf8Bytes(metadata, JsonOptions);
        var metaBlob = container.GetBlobClient(MetaJsonPath(buildId));
        using (var stream = new MemoryStream(metaBytes, writable: false))
        {
            await metaBlob.UploadAsync(
                stream,
                new BlobUploadOptions { HttpHeaders = new BlobHttpHeaders { ContentType = "application/json" } },
                ct);
        }
    }

    public async Task<byte[]> DownloadIndexHtmlAsync(Guid buildId, CancellationToken ct)
    {
        var blobClient = container.GetBlobClient(IndexHtmlPath(buildId));
        try
        {
            var result = await blobClient.DownloadContentAsync(ct);
            return result.Value.Content.ToArray();
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            throw new BuildBundleNotFoundException(buildId);
        }
    }

    public async Task<BuildBundleMetadata> DownloadMetadataAsync(Guid buildId, CancellationToken ct)
    {
        var blobClient = container.GetBlobClient(MetaJsonPath(buildId));
        try
        {
            var result = await blobClient.DownloadContentAsync(ct);
            var metadata = result.Value.Content.ToObjectFromJson<BuildBundleMetadata>(JsonOptions);
            return metadata ?? throw new InvalidOperationException($"meta.json for build '{buildId}' deserialized to null.");
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            throw new BuildBundleNotFoundException(buildId);
        }
    }

    private static string IndexHtmlPath(Guid buildId) => $"builds/{buildId}/index.html";
    private static string MetaJsonPath(Guid buildId) => $"builds/{buildId}/meta.json";
}
