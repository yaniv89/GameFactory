using Azure.Storage.Blobs;
using Forge.Domain.Entities;
using Forge.Functions.ArtGen;
using Forge.Functions.Assets;
using Forge.Infrastructure.ArtGeneration;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.ArtGeneration;

/// <summary>
/// The end-to-end proof for docs/adr/0016 Decision 2/3/6 (N3): seeds a
/// real <see cref="GenerationStatus.Queued"/> <see cref="GenerationRequest"/>
/// and drives the whole claim -> generate -> decode-safety-verify ->
/// upload -> mark cycle through <see cref="ArtGenOrchestrator"/> exactly
/// as the eventual Azure Functions Worker trigger will — the same
/// relationship <see cref="Assets.AssetOrchestratorTests"/> has to E3's
/// own trigger. <see cref="FakeArtGenerationClient"/> stands in for
/// Gemini (no real API key in this environment — that class's own doc
/// comment); everything downstream of it (the real <see cref="AssetRunner"/>
/// decode-safety pass, the real Azurite-backed <see cref="IArtGenerationStorage"/>
/// upload, the real claim/complete lifecycle) is genuinely exercised.
///
/// ⚠ Not run in this sandbox: Docker/Testcontainers is unavailable here
/// (this session's own environment — dockerd did not come up). Verified
/// when CI runs on a GitHub-hosted runner with Docker available, the same
/// as every other Testcontainers-backed suite in this project.
/// </summary>
public sealed class ArtGenOrchestratorTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    // A minimal, genuinely valid 1x1 PNG -- same fixture AssetOrchestratorTests uses.
    private static readonly byte[] TinyPngBytes = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

    public ArtGenOrchestratorTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private IArtGenerationStorage CreateStorage()
    {
        var container = new BlobContainerClient(_factory.AzuriteConnectionString, "art-generations");
        container.CreateIfNotExists();
        return new AzureBlobArtGenerationStorage(container);
    }

    private async Task<Guid> SeedQueuedRequestAsync(ForgeDbContext db, string category = ArtGenCategory.Tile)
    {
        var workspace = new Workspace { Slug = $"ws-{Guid.NewGuid():N}", Name = "ArtGen Orchestrator Fixture", CreatedAt = DateTimeOffset.UtcNow };
        db.Workspaces.Add(workspace);
        await db.SaveChangesAsync(); // workspace.Id is DB-generated -- must round-trip before it's a real value the project's FK can reference.

        var project = new Project { Id = Guid.NewGuid(), WorkspaceId = workspace.Id, Slug = "fixture", Title = "Fixture", EngineVersion = "0.1.0", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow };
        db.Projects.Add(project);
        await db.SaveChangesAsync();

        var requestId = Guid.NewGuid();
        db.GenerationRequests.Add(new GenerationRequest
        {
            Id = requestId,
            WorkspaceId = workspace.Id,
            ProjectId = project.Id,
            UserPrompt = "a mossy stone tile",
            Category = category,
            Status = GenerationStatus.Queued,
            ExpandedPrompt = "A detailed, seamless, top-down pixel-art mossy stone tile.",
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
        return requestId;
    }

    [Fact]
    public async Task A_Queued_Request_Ends_Up_Ready_With_Real_Uploaded_Variations()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var storage = CreateStorage();
        var requestId = await SeedQueuedRequestAsync(db);

        var fakeClient = new FakeArtGenerationClient
        {
            NextGenerateResult = _ => new GenerateImageResult(
                Declined: false,
                Images: [new GeneratedImage(TinyPngBytes, "image/png"), new GeneratedImage(TinyPngBytes, "image/png")],
                DeclineReason: null),
        };
        var orchestrator = new ArtGenOrchestrator(new ArtGenScanner(db), fakeClient, new AssetRunner(), storage);

        var processed = await orchestrator.ProcessNextAsync(CancellationToken.None);
        Assert.True(processed);

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var request = await verifyDb.GenerationRequests.SingleAsync(g => g.Id == requestId);
        Assert.Equal(GenerationStatus.Ready, request.Status);
        Assert.NotNull(request.CompletedAt);

        var variations = await verifyDb.GenerationVariations.Where(v => v.GenerationRequestId == requestId).ToListAsync();
        Assert.Equal(2, variations.Count); // Variation batching: both generated images survived decode-safety.
        foreach (var variation in variations)
        {
            Assert.Equal(1, variation.Width);
            Assert.Equal(1, variation.Height);

            // The real round trip through blob storage, not just "the DB
            // row looks right" -- same reasoning AssetOrchestratorTests'
            // own happy-path test gives for checking this directly.
            var container = new BlobContainerClient(_factory.AzuriteConnectionString, "art-generations");
            var blob = container.GetBlobClient(variation.ProcessedBlobPath);
            Assert.True(await blob.ExistsAsync());
        }
    }

    [Fact]
    public async Task A_Partial_Batch_Still_Succeeds_When_At_Least_One_Image_Decodes()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var storage = CreateStorage();
        var requestId = await SeedQueuedRequestAsync(db);

        var fakeClient = new FakeArtGenerationClient
        {
            NextGenerateResult = _ => new GenerateImageResult(
                Declined: false,
                Images: [new GeneratedImage(TinyPngBytes, "image/png"), new GeneratedImage("not a real image"u8.ToArray(), "image/png")],
                DeclineReason: null),
        };
        var orchestrator = new ArtGenOrchestrator(new ArtGenScanner(db), fakeClient, new AssetRunner(), storage);

        await orchestrator.ProcessNextAsync(CancellationToken.None);

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var request = await verifyDb.GenerationRequests.SingleAsync(g => g.Id == requestId);
        Assert.Equal(GenerationStatus.Ready, request.Status); // One good image is still a real, usable result.

        var variations = await verifyDb.GenerationVariations.Where(v => v.GenerationRequestId == requestId).ToListAsync();
        Assert.Single(variations); // Only the decodable one was kept -- the garbage one was dropped, not fatal to the whole request.
    }

    [Fact]
    public async Task Every_Image_Failing_Decode_Safety_Ends_Up_Failed_Not_Declined()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var storage = CreateStorage();
        var requestId = await SeedQueuedRequestAsync(db);

        var fakeClient = new FakeArtGenerationClient
        {
            NextGenerateResult = _ => new GenerateImageResult(
                Declined: false,
                Images: [new GeneratedImage("not a real image"u8.ToArray(), "image/png")],
                DeclineReason: null),
        };
        var orchestrator = new ArtGenOrchestrator(new ArtGenScanner(db), fakeClient, new AssetRunner(), storage);

        var processed = await orchestrator.ProcessNextAsync(CancellationToken.None);
        Assert.True(processed); // A Failed verdict is real progress, not "nothing to do."

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var request = await verifyDb.GenerationRequests.SingleAsync(g => g.Id == requestId);
        Assert.Equal(GenerationStatus.Failed, request.Status);
        Assert.NotNull(request.ErrorMessage);
        Assert.Empty(await verifyDb.GenerationVariations.Where(v => v.GenerationRequestId == requestId).ToListAsync());
    }

    [Fact]
    public async Task A_Declined_Image_Generation_Call_Ends_Up_Declined_Not_Failed()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var storage = CreateStorage();
        var requestId = await SeedQueuedRequestAsync(db, category: ArtGenCategory.Prop);

        var fakeClient = new FakeArtGenerationClient
        {
            NextGenerateResult = _ => new GenerateImageResult(Declined: true, Images: [], DeclineReason: "Policy violation."),
        };
        var orchestrator = new ArtGenOrchestrator(new ArtGenScanner(db), fakeClient, new AssetRunner(), storage);

        await orchestrator.ProcessNextAsync(CancellationToken.None);

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var request = await verifyDb.GenerationRequests.SingleAsync(g => g.Id == requestId);
        Assert.Equal(GenerationStatus.Declined, request.Status);
        Assert.Equal("Policy violation.", request.ErrorMessage);
    }

    [Fact]
    public async Task A_Harness_Failure_Requeues_Rather_Than_Marking_Failed_Or_Declined()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var storage = CreateStorage();
        var requestId = await SeedQueuedRequestAsync(db);

        var fakeClient = new FakeArtGenerationClient { ThrowOnNextGenerate = true };
        var orchestrator = new ArtGenOrchestrator(new ArtGenScanner(db), fakeClient, new AssetRunner(), storage);

        await Assert.ThrowsAsync<ArtGenHarnessException>(() => orchestrator.ProcessNextAsync(CancellationToken.None));

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var request = await verifyDb.GenerationRequests.SingleAsync(g => g.Id == requestId);

        // Back to Queued, not stuck Generating and not falsely Failed --
        // a later tick (this worker instance or another) gets to retry it.
        Assert.Equal(GenerationStatus.Queued, request.Status);
        Assert.Null(request.ErrorMessage);
        Assert.Null(request.CompletedAt);

        // Clean up: this test deliberately leaves a real Queued row behind
        // (that's the property under test) -- ArtGenScanner's claim query
        // has no per-test scoping, so an un-drained Queued row here would
        // be the *oldest* one left in the shared Postgres container and
        // get silently claimed by a later test's own ProcessNextAsync
        // call instead of that test's own freshly-seeded row. Removing it
        // keeps this test's side effect from leaking into any other test
        // in this class, regardless of xUnit's actual execution order
        // (never guaranteed to match declaration order).
        verifyDb.GenerationRequests.Remove(request);
        await verifyDb.SaveChangesAsync();
    }

    [Fact]
    public async Task Nothing_Queued_Returns_False_Rather_Than_Throwing()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var orchestrator = new ArtGenOrchestrator(new ArtGenScanner(db), new FakeArtGenerationClient(), new AssetRunner(), CreateStorage());

        // Whatever other tests in this class have already queued and
        // consumed, draining to empty first makes this assertion
        // meaningful regardless of run order/parallelism within the
        // shared Postgres container other tests in this project also use.
        while (await orchestrator.ProcessNextAsync(CancellationToken.None))
        {
        }

        Assert.False(await orchestrator.ProcessNextAsync(CancellationToken.None));
    }
}
