using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;

namespace Forge.Infrastructure.Storage;

public sealed class AzureBlobPackageBundleStorage(BlobContainerClient container) : IPackageBundleStorage
{
    public async Task<string> UploadAsync(string packageName, string version, byte[] content, string contentType, CancellationToken ct)
    {
        var blobClient = container.GetBlobClient(BlobPath(packageName, version));

        using var stream = new MemoryStream(content, writable: false);
        try
        {
            await blobClient.UploadAsync(
                stream,
                new BlobUploadOptions
                {
                    HttpHeaders = new BlobHttpHeaders { ContentType = contentType },
                    // If-None-Match: * — create-only. The blob-layer half
                    // of the immutability guarantee IPackageBundleStorage
                    // documents; PublishVersionEndpoint's database unique
                    // index on (package_id, version) is the other half.
                    Conditions = new BlobRequestConditions { IfNoneMatch = ETag.All },
                },
                ct);
        }
        catch (RequestFailedException ex) when (ex.Status == 409)
        {
            throw new BundleAlreadyExistsException(packageName, version);
        }

        return blobClient.Uri.ToString();
    }

    public async Task<byte[]> DownloadAsync(string packageName, string version, CancellationToken ct)
    {
        var blobClient = container.GetBlobClient(BlobPath(packageName, version));
        try
        {
            var result = await blobClient.DownloadContentAsync(ct);
            return result.Value.Content.ToArray();
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            throw new BundleNotFoundException(packageName, version);
        }
    }

    private static string BlobPath(string packageName, string version) => $"packages/{packageName}/{version}/bundle.js";
}
