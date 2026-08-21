using System.Net;
using System.Net.Http.Json;
using Azure.Storage.Blobs;
using Forge.Api.Features.Assets;
using Forge.Api.Features.ArtGeneration;
using Forge.Api.Features.Projects;
using Forge.Domain.Entities;
using Forge.Functions.ArtGen;
using Forge.Functions.Assets;
using Forge.Infrastructure.ArtGeneration;
using Forge.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace Forge.Tests.Features.ArtGeneration;

/// <summary>
/// N8: CLAUDE.md's own "the feature works, verified by running it, not
/// by reasoning that it should work" applied to docs/adr/0016's exit
/// criterion — real text in, real usable asset out. Every prior N-stage
/// test drove one endpoint or one worker method in isolation
/// (<see cref="ArtGenerationEndpointsTests"/> for the HTTP surface,
/// <see cref="ArtGenOrchestratorTests"/> for the worker, seeded directly
/// into the database); nothing until this class walks the *entire*
/// chain in one continuous run the way a real deploy actually would:
/// real HTTP Create -&gt; real HTTP Confirm -&gt; the real
/// <see cref="ArtGenOrchestrator"/> claiming that exact row over a real
/// Postgres connection -&gt; real HTTP Get/Content -&gt; real HTTP Select
/// -&gt; the promoted result served back through the *pre-existing*,
/// unmodified E4 asset-content endpoint, proving a generated asset is
/// genuinely indistinguishable from a hand-uploaded one, not merely
/// designed to be.
///
/// What this deliberately does NOT prove, honestly: that a real Gemini
/// call produces a real expanded prompt or a real image.
/// <see cref="FakeArtGenerationClient"/> stands in for both calls — no
/// real Gemini API key exists in this environment (that class's own doc
/// comment, unchanged since N2). What's genuinely exercised is
/// everything Forge itself owns: the full HTTP surface, the real
/// claim/orchestrate worker lifecycle over real Postgres row locking,
/// the real decode-safety pipeline, the real chroma-key port running on
/// real pixels, real Azurite blob round-trips for both the generation
/// container and the promoted asset's own container, and the real
/// pre-existing Art Pack asset-resolution endpoint.
///
/// Docker/Testcontainers availability in this sandbox is intermittent
/// (some sessions' <c>dockerd</c> comes up, some don't) — verified for
/// real, end to end, whenever it's available here; otherwise verified
/// when CI runs on a GitHub-hosted runner, the same as every other
/// Testcontainers-backed suite in this project.
/// </summary>
public sealed class ArtGenerationExitCriteriaTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    // A minimal, genuinely valid 1x1 PNG -- stands in for a Tile
    // variation, where the whole frame is the usable content (docs/adr/0014:
    // no transparency needed for terrain tiles) and no chroma-keying runs.
    private static readonly byte[] TinyPngBytes = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

    public ArtGenerationExitCriteriaTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    // A 40x40 magenta-background PNG with a solid 20x20 red square --
    // exactly the shape GeminiArtGenerationClient's own Prop system
    // instruction asks the model to produce, standing in for what a real
    // Gemini call would return.
    private static byte[] MakeMagentaPropPngBytes()
    {
        using var image = new Image<Rgba32>(40, 40, new Rgba32(255, 0, 255, 255));
        image.ProcessPixelRows(accessor =>
        {
            for (var y = 10; y < 30; y++)
            {
                var row = accessor.GetRowSpan(y);
                for (var x = 10; x < 30; x++) row[x] = new Rgba32(200, 40, 40, 255);
            }
        });
        using var stream = new MemoryStream();
        image.Save(stream, new PngEncoder());
        return stream.ToArray();
    }

    private static async Task<ProjectDetailResponse> CreateProjectAsync(AuthenticatedTestUser user)
    {
        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects",
            new { slug = $"proj-{Guid.NewGuid():N}", title = "Exit Criteria Project", description = (string?)null, engineVersion = "0.1.0", genreTemplate = (string?)null });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ProjectDetailResponse>())!;
    }

    private async Task<(AuthenticatedTestUser User, Guid ProjectId)> CreateStudioUserWithProjectAsync()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var project = await CreateProjectAsync(user);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<Forge.Infrastructure.Persistence.ForgeDbContext>();
        await db.Workspaces.Where(w => w.Id == user.WorkspaceId).ExecuteUpdateAsync(s => s.SetProperty(w => w.Plan, WorkspacePlan.Studio));
        return (user, project.Id);
    }

    private ArtGenOrchestrator CreateOrchestrator()
    {
        var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<Forge.Infrastructure.Persistence.ForgeDbContext>();
        var container = new BlobContainerClient(_factory.AzuriteConnectionString, "art-generations");
        container.CreateIfNotExists();
        return new ArtGenOrchestrator(new ArtGenScanner(db), _factory.ArtGenerationClient, new AssetRunner(), new AzureBlobArtGenerationStorage(container));
    }

    [Fact]
    public async Task Describe_A_Tile_Confirm_It_Generate_It_And_Get_A_Real_Usable_Asset_Out()
    {
        var (user, projectId) = await CreateStudioUserWithProjectAsync();
        _factory.ArtGenerationClient.NextExpandResult = _ => new ExpandPromptResult(
            Declined: false, ExpandedPrompt: "A seamless, tileable, weathered gray stone texture with faint moss in the cracks.", DeclineReason: null);
        _factory.ArtGenerationClient.NextGenerateResult = _ => new GenerateImageResult(
            Declined: false, Images: [new GeneratedImage(TinyPngBytes, "image/png")], DeclineReason: null);

        // 1. Describe it.
        var createResponse = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation",
            new { userPrompt = "a mossy stone tile", category = ArtGenCategory.Tile });
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        var created = (await createResponse.Content.ReadFromJsonAsync<GenerationRequestResponse>())!;
        Assert.Equal(GenerationStatus.AwaitingConfirmation, created.Status);
        Assert.Equal("A seamless, tileable, weathered gray stone texture with faint moss in the cracks.", created.ExpandedPrompt);

        // 2. Confirm it -- the creator sees the real expanded prompt before any generation cost is spent.
        var confirmResponse = await user.Client.PostAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{created.Id}/confirm", null);
        Assert.Equal(HttpStatusCode.OK, confirmResponse.StatusCode);
        Assert.Equal(GenerationStatus.Queued, (await confirmResponse.Content.ReadFromJsonAsync<GenerationRequestResponse>())!.Status);

        // 3. Generate it -- the real worker, claiming the real row.
        var orchestrator = CreateOrchestrator();
        Assert.True(await orchestrator.ProcessNextAsync(CancellationToken.None));

        // 4. Poll it -- the same GET the editor's own poll loop calls.
        var pollResponse = await user.Client.GetAsync($"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{created.Id}");
        var polled = (await pollResponse.Content.ReadFromJsonAsync<GenerationRequestResponse>())!;
        Assert.Equal(GenerationStatus.Ready, polled.Status);
        var variation = Assert.Single(polled.Variations);
        // A Tile variation is stored at full canvas size, untouched --
        // no chroma-keying, docs/adr/0014's own "the whole frame is the tile."
        Assert.Equal(1, variation.Width);
        Assert.Equal(1, variation.Height);

        // 5. Look at it -- round-tripped through real Azurite storage.
        // Not a raw-byte comparison against TinyPngBytes: docs/adr/0012
        // Decision 4 is explicit that served content is always the
        // re-encoded output AssetRunner produced from decoded pixels,
        // never a pass-through of the originally-uploaded bytes (the
        // deliberate answer to CWE-787 for the T6 pipeline this reuses)
        // -- so the real assertion is pixel/dimension equality, decoded
        // independently, not byte-for-byte identity.
        var contentResponse = await user.Client.GetAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{created.Id}/variations/{variation.Id}/content");
        Assert.Equal(HttpStatusCode.OK, contentResponse.StatusCode);
        using (var decodedVariation = Image.Load<Rgba32>(await contentResponse.Content.ReadAsByteArrayAsync()))
        {
            Assert.Equal(1, decodedVariation.Width);
            Assert.Equal(1, decodedVariation.Height);
        }

        // 6. Keep it -- promoted into a real, named Asset.
        var selectResponse = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{created.Id}/variations/{variation.Id}/select",
            new { assetName = "tilesets/moss-stone.png" });
        Assert.Equal(HttpStatusCode.Created, selectResponse.StatusCode);
        var selected = (await selectResponse.Content.ReadFromJsonAsync<SelectGenerationVariationResponse>())!;

        // 7. Use it -- exactly the pre-existing E4 endpoint a hand-uploaded
        // asset is served through, completely unmodified for this feature.
        // This is the exit criterion made concrete: a generated asset is
        // not a special case anywhere downstream of this point. Same
        // bytes as what the variation endpoint served in step 5 (Select
        // copies the already-processed bytes verbatim into the asset's
        // own container, no further re-encoding) -- checked as an exact
        // byte match between *those two responses*, not against the
        // original fixture bytes.
        var variationBytes = await (await user.Client.GetAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{created.Id}/variations/{variation.Id}/content")).Content.ReadAsByteArrayAsync();
        var assetContentResponse = await user.Client.GetAsync($"/api/v1/workspaces/{user.WorkspaceId}/assets/content/tilesets/moss-stone.png");
        Assert.Equal(HttpStatusCode.OK, assetContentResponse.StatusCode);
        Assert.Equal(variationBytes, await assetContentResponse.Content.ReadAsByteArrayAsync());

        var listResponse = await user.Client.GetAsync($"/api/v1/workspaces/{user.WorkspaceId}/assets");
        var list = (await listResponse.Content.ReadFromJsonAsync<AssetListResponse>())!;
        var asset = Assert.Single(list.Assets, a => a.Id == selected.AssetId);
        Assert.Equal("ready", asset.Status);
        Assert.Equal("tilesets/moss-stone.png", asset.OriginalName);
    }

    [Fact]
    public async Task Describe_A_Prop_Confirm_It_Generate_It_And_Get_A_Real_Chroma_Keyed_Usable_Asset_Out()
    {
        var (user, projectId) = await CreateStudioUserWithProjectAsync();
        var propBytes = MakeMagentaPropPngBytes();
        _factory.ArtGenerationClient.NextExpandResult = _ => new ExpandPromptResult(
            Declined: false, ExpandedPrompt: "A single wooden crate, isometric, centered on a solid magenta background.", DeclineReason: null);
        _factory.ArtGenerationClient.NextGenerateResult = _ => new GenerateImageResult(
            Declined: false, Images: [new GeneratedImage(propBytes, "image/png")], DeclineReason: null);

        var createResponse = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation",
            new { userPrompt = "a wooden crate", category = ArtGenCategory.Prop });
        var created = (await createResponse.Content.ReadFromJsonAsync<GenerationRequestResponse>())!;

        await user.Client.PostAsync($"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{created.Id}/confirm", null);

        var orchestrator = CreateOrchestrator();
        Assert.True(await orchestrator.ProcessNextAsync(CancellationToken.None));

        var pollResponse = await user.Client.GetAsync($"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{created.Id}");
        var polled = (await pollResponse.Content.ReadFromJsonAsync<GenerationRequestResponse>())!;
        Assert.Equal(GenerationStatus.Ready, polled.Status);
        var variation = Assert.Single(polled.Variations);
        // Chroma-keyed and cropped to content, not the raw 40x40 canvas
        // -- the 20x20 red square plus 2px padding on each side, exactly
        // ChromaKeyExtractorTests' own crop math for this fixture shape.
        Assert.Equal(24, variation.Width);
        Assert.Equal(24, variation.Height);

        var selectResponse = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{created.Id}/variations/{variation.Id}/select",
            new { assetName = "props/wooden-crate.png" });
        var selected = (await selectResponse.Content.ReadFromJsonAsync<SelectGenerationVariationResponse>())!;

        var assetContentResponse = await user.Client.GetAsync($"/api/v1/workspaces/{user.WorkspaceId}/assets/content/props/wooden-crate.png");
        Assert.Equal(HttpStatusCode.OK, assetContentResponse.StatusCode);
        using var servedImage = Image.Load<Rgba32>(await assetContentResponse.Content.ReadAsByteArrayAsync());
        // The concrete proof that a hostile-looking magenta background
        // actually became real, usable transparency by the time a player
        // (or the editor's own scene canvas) ever sees this asset: the
        // corner (background) is fully transparent, the center (the real
        // subject) is fully opaque and still the crate's own color.
        Assert.Equal(0, servedImage[0, 0].A);
        var center = servedImage[servedImage.Width / 2, servedImage.Height / 2];
        Assert.Equal(255, center.A);
        Assert.Equal((200, 40, 40), (center.R, center.G, center.B));

        var listResponse = await user.Client.GetAsync($"/api/v1/workspaces/{user.WorkspaceId}/assets");
        var list = (await listResponse.Content.ReadFromJsonAsync<AssetListResponse>())!;
        Assert.Contains(list.Assets, a => a.Id == selected.AssetId && a.Status == "ready");
    }
}
