using System.Buffers.Binary;
using Azure.Storage.Blobs;
using Forge.Domain.Entities;
using Forge.Functions.Assets;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Assets;

/// <summary>
/// The end-to-end proof for docs/adr/0012 Decision 4: seeds a real
/// <see cref="AssetStatus.Pending"/> <see cref="Asset"/> with a real
/// quarantined original in the real Azurite-backed
/// <see cref="IAssetStorage"/>, and drives the whole claim -> decode ->
/// re-encode -> upload -> mark cycle through <see cref="AssetOrchestrator"/>
/// exactly as the eventual Azure Functions Worker trigger will — the same
/// relationship <see cref="Builds.BuildOrchestratorTests"/> has to C3's
/// own trigger.
/// </summary>
public sealed class AssetOrchestratorTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    // A minimal, genuinely valid 1x1 PNG — same fixture Assets.AssetsEndpointsTests uses.
    private static readonly byte[] TinyPngBytes = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

    public AssetOrchestratorTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    /// <summary>
    /// A hand-crafted, syntactically real PNG (correct signature, a real
    /// IHDR chunk with a correct CRC) whose header declares an enormous
    /// 50000x50000 image — proving AssetRunner's dimension cap rejects it
    /// from the header alone, the same real bytes this ADR's own security
    /// reasoning was verified against directly (not a mock of "a big
    /// image," a file a real PNG parser genuinely reads as declaring that
    /// size).
    /// </summary>
    private static byte[] OversizedDimensionPngBytes()
    {
        static byte[] Crc32(byte[] data)
        {
            var table = new uint[256];
            for (uint n = 0; n < 256; n++)
            {
                var c = n;
                for (var k = 0; k < 8; k++) c = (c & 1) != 0 ? 0xedb88320 ^ (c >> 1) : c >> 1;
                table[n] = c;
            }
            var crc = 0xffffffffu;
            foreach (var b in data) crc = table[(crc ^ b) & 0xff] ^ (crc >> 8);
            crc ^= 0xffffffffu;
            var result = new byte[4];
            BinaryPrimitives.WriteUInt32BigEndian(result, crc);
            return result;
        }

        static byte[] Chunk(string type, byte[] data)
        {
            var lenBytes = new byte[4];
            BinaryPrimitives.WriteUInt32BigEndian(lenBytes, (uint)data.Length);
            var typeAndData = System.Text.Encoding.ASCII.GetBytes(type).Concat(data).ToArray();
            return lenBytes.Concat(typeAndData).Concat(Crc32(typeAndData)).ToArray();
        }

        var signature = new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
        var ihdrData = new byte[13];
        BinaryPrimitives.WriteUInt32BigEndian(ihdrData.AsSpan(0, 4), 50_000);
        BinaryPrimitives.WriteUInt32BigEndian(ihdrData.AsSpan(4, 4), 50_000);
        ihdrData[8] = 8; // bit depth
        ihdrData[9] = 6; // color type RGBA
        var ihdr = Chunk("IHDR", ihdrData);
        var idat = Chunk("IDAT", []);
        var iend = Chunk("IEND", []);

        return [.. signature, .. ihdr, .. idat, .. iend];
    }

    private IAssetStorage CreateStorage()
    {
        var quarantine = new BlobContainerClient(_factory.AzuriteConnectionString, "assets-quarantine");
        quarantine.CreateIfNotExists();
        var pub = new BlobContainerClient(_factory.AzuriteConnectionString, "assets");
        pub.CreateIfNotExists();
        return new AzureBlobAssetStorage(quarantine, pub);
    }

    private async Task<Guid> SeedPendingAssetAsync(ForgeDbContext db, IAssetStorage storage, byte[]? originalBytes)
    {
        var workspace = new Workspace { Slug = $"ws-{Guid.NewGuid():N}", Name = "Asset Orchestrator Fixture", CreatedAt = DateTimeOffset.UtcNow };
        db.Workspaces.Add(workspace);
        await db.SaveChangesAsync();

        var assetId = Guid.NewGuid();
        if (originalBytes is not null)
        {
            // The real thing AssetOrchestrator's own storage.DownloadOriginalAsync
            // reads back — omitted entirely by the harness-failure test
            // below, which needs a Pending row with NO quarantined blob.
            await storage.UploadOriginalAsync(workspace.Id, assetId, originalBytes, CancellationToken.None);
        }

        var asset = new Asset
        {
            Id = assetId,
            WorkspaceId = workspace.Id,
            OriginalName = "fixture.png",
            DeclaredMimeType = "image/png",
            Status = AssetStatus.Pending,
            QuarantineBlobPath = $"{workspace.Id}/{assetId}/original",
            Sha256 = System.Security.Cryptography.SHA256.HashData(originalBytes ?? []),
            SizeBytes = originalBytes?.Length ?? 0,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Assets.Add(asset);
        await db.SaveChangesAsync();
        return assetId;
    }

    [Fact]
    public async Task A_Pending_Valid_Png_Ends_Up_Ready_With_A_Real_Reencoded_Blob()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var storage = CreateStorage();
        var assetId = await SeedPendingAssetAsync(db, storage, TinyPngBytes);

        var orchestrator = new AssetOrchestrator(new AssetScanner(db), new AssetRunner(), storage);

        var processed = await orchestrator.ProcessNextAsync(CancellationToken.None);
        Assert.True(processed);

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var asset = await verifyDb.Assets.SingleAsync(a => a.Id == assetId);

        Assert.Equal(AssetStatus.Ready, asset.Status);
        Assert.Equal($"{asset.WorkspaceId}/{assetId}/opt.png", asset.ProcessedBlobPath);
        Assert.Equal(1, asset.Width);
        Assert.Equal(1, asset.Height);
        Assert.NotNull(asset.CompletedAt);
        Assert.Null(asset.ErrorMessage);

        // The real round trip through blob storage, not just "the DB row
        // looks right" — an asset the row claims is Ready but whose blob
        // never actually landed would be a real, user-visible failure
        // mode (E4's Art Pack resolution would 404 forever) this test
        // would catch. DownloadProcessedAsync doesn't exist on
        // IAssetStorage (nothing reads the public container back through
        // this interface — a real image URL will, once E4 wires that up),
        // so this reads the blob directly to prove it's really there.
        var container = new BlobContainerClient(_factory.AzuriteConnectionString, "assets");
        var blob = container.GetBlobClient($"{asset.WorkspaceId}/{assetId}/opt.png");
        Assert.True(await blob.ExistsAsync());
        var downloaded = await blob.DownloadContentAsync();
        Assert.True(downloaded.Value.Content.ToArray().Length > 0);
    }

    [Fact]
    public async Task Nothing_Pending_Returns_False_Rather_Than_Throwing()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var orchestrator = new AssetOrchestrator(new AssetScanner(db), new AssetRunner(), CreateStorage());

        // Whatever other tests in this class have already queued and
        // consumed, draining to empty first makes this assertion
        // meaningful regardless of run order/parallelism within the
        // shared Postgres container other tests in this project also use.
        while (await orchestrator.ProcessNextAsync(CancellationToken.None))
        {
        }

        Assert.False(await orchestrator.ProcessNextAsync(CancellationToken.None));
    }

    [Fact]
    public async Task Invalid_Image_Bytes_End_Up_Failed_With_A_Real_Attributable_Error_Not_A_Harness_Retry()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var storage = CreateStorage();
        var assetId = await SeedPendingAssetAsync(db, storage, "not a real image"u8.ToArray());

        var orchestrator = new AssetOrchestrator(new AssetScanner(db), new AssetRunner(), storage);

        var processed = await orchestrator.ProcessNextAsync(CancellationToken.None);
        Assert.True(processed); // The orchestrator did work this tick — a Failed verdict is real progress, not "nothing to do."

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var asset = await verifyDb.Assets.SingleAsync(a => a.Id == assetId);

        Assert.Equal(AssetStatus.Failed, asset.Status);
        Assert.Contains("valid PNG", asset.ErrorMessage, StringComparison.Ordinal);
        Assert.Null(asset.ProcessedBlobPath);
        Assert.NotNull(asset.CompletedAt);
    }

    [Fact]
    public async Task Oversized_Declared_Dimensions_End_Up_Failed_Naming_The_Actual_Limit()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var storage = CreateStorage();
        var assetId = await SeedPendingAssetAsync(db, storage, OversizedDimensionPngBytes());

        var orchestrator = new AssetOrchestrator(new AssetScanner(db), new AssetRunner(), storage);
        await orchestrator.ProcessNextAsync(CancellationToken.None);

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var asset = await verifyDb.Assets.SingleAsync(a => a.Id == assetId);

        Assert.Equal(AssetStatus.Failed, asset.Status);
        Assert.Contains("50000x50000", asset.ErrorMessage, StringComparison.Ordinal);
        Assert.Contains("4096x4096", asset.ErrorMessage, StringComparison.Ordinal);
        Assert.Null(asset.ProcessedBlobPath);
    }

    [Fact]
    public async Task A_Missing_Quarantine_Blob_Is_A_Harness_Failure_That_Requeues_Rather_Than_Marking_Failed()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var storage = CreateStorage();
        // No originalBytes uploaded at all — a Pending row whose
        // quarantine blob genuinely doesn't exist, the real trigger for
        // AssetOriginalNotFoundException -> AssetHarnessException.
        var assetId = await SeedPendingAssetAsync(db, storage, originalBytes: null);

        var orchestrator = new AssetOrchestrator(new AssetScanner(db), new AssetRunner(), storage);

        await Assert.ThrowsAsync<AssetHarnessException>(() => orchestrator.ProcessNextAsync(CancellationToken.None));

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var asset = await verifyDb.Assets.SingleAsync(a => a.Id == assetId);

        // Back to Pending, not stuck Processing and not falsely Failed —
        // a later tick (this worker instance or another) gets to retry it.
        Assert.Equal(AssetStatus.Pending, asset.Status);
        Assert.Null(asset.ErrorMessage);
        Assert.Null(asset.CompletedAt);
    }
}
