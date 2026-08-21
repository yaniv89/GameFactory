using System.Net;
using System.Net.Http.Json;
using Azure.Storage.Blobs;
using Forge.Api.Features.ArtGeneration;
using Forge.Api.Features.Projects;
using Forge.Domain.Entities;
using Forge.Infrastructure.ArtGeneration;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.ArtGeneration;

/// <summary>
/// docs/adr/0016 Decision 2/6, driven through real HTTP against the real
/// host and <see cref="FakeArtGenerationClient"/> (no real Gemini API key
/// exists in this environment — see that class's own doc comment).
/// Proves the endpoints' own logic: validation, the workspace:pro plan
/// gate, the live daily-budget check, and the Declined/Failed/
/// AwaitingConfirmation-&gt;Queued status machine. What this deliberately
/// does NOT prove: that a real Gemini call produces a real expanded
/// prompt or a real image — <see cref="FakeArtGenerationClient"/>'s own
/// doc comment.
///
/// Docker/Testcontainers availability in this sandbox is intermittent
/// (some sessions' <c>dockerd</c> comes up, some don't) — verified for
/// real, end to end, whenever it's available here; otherwise verified
/// when CI runs on a GitHub-hosted runner, the same as every other
/// Testcontainers-backed suite in this project.
/// </summary>
public sealed class ArtGenerationEndpointsTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public ArtGenerationEndpointsTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private async Task SetWorkspacePlanAsync(Guid workspaceId, string plan)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        await db.Workspaces.Where(w => w.Id == workspaceId).ExecuteUpdateAsync(s => s.SetProperty(w => w.Plan, plan));
    }

    private static async Task<ProjectDetailResponse> CreateProjectAsync(AuthenticatedTestUser user)
    {
        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects",
            new { slug = $"proj-{Guid.NewGuid():N}", title = "Art Gen Project", description = (string?)null, engineVersion = "0.1.0", genreTemplate = (string?)null });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ProjectDetailResponse>())!;
    }

    private async Task<(AuthenticatedTestUser User, Guid ProjectId)> CreateProUserWithProjectAsync()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var project = await CreateProjectAsync(user);
        await SetWorkspacePlanAsync(user.WorkspaceId, WorkspacePlan.Pro);
        return (user, project.Id);
    }

    // A minimal, genuinely valid 1x1 PNG -- same fixture AssetsEndpointsTests/ArtGenOrchestratorTests use.
    private static readonly byte[] TinyPngBytes = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=");

    // N5's endpoints operate on a request that's already Ready with real
    // variation content -- ArtGenOrchestratorTests already fully proves
    // Queued -> Ready via the real orchestrator (N3/N4), so seeding
    // straight to Ready here keeps these tests focused on the endpoints'
    // own logic (poll response shape, content serving, select/promote)
    // rather than re-driving that whole pipeline through this class too.
    private Task<(Guid RequestId, Guid VariationId)> SeedReadyRequestWithVariationAsync(
        Guid workspaceId, Guid projectId, Guid userId, byte[] pngBytes, int width = 1, int height = 1) =>
        SeedRequestWithVariationAsync(workspaceId, projectId, userId, pngBytes, GenerationStatus.Ready, width, height);

    // ArtGenScanner.MarkReadyAsync (N3) writes the GenerationVariation row
    // and flips Status to Ready in two separate SaveChanges/ExecuteUpdate
    // calls, not one transaction -- a real, if narrow, window where a
    // request's own variation already exists while its Status still
    // reads Generating. This helper reproduces that exact window
    // deterministically, for SelectGenerationVariationEndpoint's own
    // "request.Status != Ready" conflict check, which guards precisely
    // this race.
    private async Task<(Guid RequestId, Guid VariationId)> SeedRequestWithVariationAsync(
        Guid workspaceId, Guid projectId, Guid userId, byte[] pngBytes, string status, int width = 1, int height = 1)
    {
        var requestId = Guid.NewGuid();
        var variationId = Guid.NewGuid();
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
            db.GenerationRequests.Add(new GenerationRequest
            {
                Id = requestId,
                WorkspaceId = workspaceId,
                ProjectId = projectId,
                UserPrompt = "a mossy stone tile",
                Category = ArtGenCategory.Tile,
                Status = status,
                ExpandedPrompt = "A seamless, tileable mossy stone texture.",
                RequestedByUserId = userId,
                CreatedAt = DateTimeOffset.UtcNow,
                CompletedAt = status == GenerationStatus.Ready ? DateTimeOffset.UtcNow : null,
                Variations =
                [
                    new GenerationVariation
                    {
                        Id = variationId,
                        GenerationRequestId = requestId,
                        ProcessedBlobPath = $"{workspaceId}/{requestId}/{variationId}.png",
                        Width = width,
                        Height = height,
                        CreatedAt = DateTimeOffset.UtcNow,
                    },
                ],
            });
            await db.SaveChangesAsync();
        }

        var container = new BlobContainerClient(_factory.AzuriteConnectionString, "art-generations");
        await container.CreateIfNotExistsAsync();
        var storage = new AzureBlobArtGenerationStorage(container);
        await storage.UploadVariationAsync(workspaceId, requestId, variationId, pngBytes, CancellationToken.None);

        return (requestId, variationId);
    }

    [Fact]
    public async Task Free_Workspace_Gets_402_Not_A_Real_Gemini_Call()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var project = await CreateProjectAsync(user);

        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{project.Id}/art-generation",
            new { userPrompt = "a mossy stone tile", category = ArtGenCategory.Tile });

        Assert.Equal(HttpStatusCode.PaymentRequired, response.StatusCode);
        Assert.DoesNotContain(_factory.ArtGenerationClient.ExpandRequests, r => r.UserPrompt == "a mossy stone tile");
    }

    [Fact]
    public async Task Empty_Prompt_Is_A_Validation_Problem()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();

        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation",
            new { userPrompt = "", category = ArtGenCategory.Tile });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Unknown_Category_Is_A_Validation_Problem()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();

        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation",
            new { userPrompt = "a green goblin", category = "character" }); // docs/adr/0016 Decision 1: not a v1 category.

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Valid_Request_Expands_The_Prompt_And_Awaits_Confirmation()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();

        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation",
            new { userPrompt = "a mossy stone tile", category = ArtGenCategory.Tile });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<GenerationRequestResponse>())!;
        Assert.Equal(GenerationStatus.AwaitingConfirmation, body.Status);
        Assert.NotNull(body.ExpandedPrompt);
        Assert.Null(body.ErrorMessage);

        // docs/adr/0016 Decision 5: the creator's own text reached the
        // client as user content, category-correctly.
        var recorded = Assert.Single(_factory.ArtGenerationClient.ExpandRequests, r => r.UserPrompt == "a mossy stone tile");
        Assert.Equal(ArtGenCategory.Tile, recorded.Category);
    }

    [Fact]
    public async Task Declined_Expansion_Is_Recorded_As_Declined_Not_Failed()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();
        _factory.ArtGenerationClient.NextExpandResult = _ => new ExpandPromptResult(Declined: true, ExpandedPrompt: null, DeclineReason: "Policy violation: weapons.");

        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation",
            new { userPrompt = "something the safety filter refuses", category = ArtGenCategory.Prop });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<GenerationRequestResponse>())!;
        Assert.Equal(GenerationStatus.Declined, body.Status);
        Assert.Null(body.ExpandedPrompt);
        Assert.Equal("Policy violation: weapons.", body.ErrorMessage);
    }

    [Fact]
    public async Task Harness_Failure_Is_Recorded_As_Failed_Not_Declined()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();
        _factory.ArtGenerationClient.ThrowOnNextExpand = true;

        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation",
            new { userPrompt = "a mossy stone tile", category = ArtGenCategory.Tile });

        // The HTTP call itself still succeeds (a row was created) --
        // docs/adr/0016's own "the log only ever grows" reasoning, same
        // as Build/Asset's own async Failed state.
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<GenerationRequestResponse>())!;
        Assert.Equal(GenerationStatus.Failed, body.Status);
        Assert.NotNull(body.ErrorMessage);
    }

    [Fact]
    public async Task Confirm_Moves_An_Awaiting_Confirmation_Request_To_Queued()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();
        var createResponse = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation",
            new { userPrompt = "a mossy stone tile", category = ArtGenCategory.Tile });
        var created = (await createResponse.Content.ReadFromJsonAsync<GenerationRequestResponse>())!;

        var confirmResponse = await user.Client.PostAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{created.Id}/confirm", null);

        Assert.Equal(HttpStatusCode.OK, confirmResponse.StatusCode);
        var confirmed = (await confirmResponse.Content.ReadFromJsonAsync<GenerationRequestResponse>())!;
        Assert.Equal(GenerationStatus.Queued, confirmed.Status);
    }

    [Fact]
    public async Task Confirming_A_Declined_Request_Is_A_Conflict()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();
        _factory.ArtGenerationClient.NextExpandResult = _ => new ExpandPromptResult(Declined: true, ExpandedPrompt: null, DeclineReason: "Declined.");
        var createResponse = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation",
            new { userPrompt = "something declined", category = ArtGenCategory.Tile });
        var created = (await createResponse.Content.ReadFromJsonAsync<GenerationRequestResponse>())!;

        var confirmResponse = await user.Client.PostAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{created.Id}/confirm", null);

        Assert.Equal(HttpStatusCode.Conflict, confirmResponse.StatusCode);
    }

    [Fact]
    public async Task Confirming_Twice_Is_A_Conflict_The_Second_Time()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();
        var createResponse = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation",
            new { userPrompt = "a mossy stone tile", category = ArtGenCategory.Tile });
        var created = (await createResponse.Content.ReadFromJsonAsync<GenerationRequestResponse>())!;
        var confirmUrl = $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{created.Id}/confirm";
        await user.Client.PostAsync(confirmUrl, null);

        var secondConfirm = await user.Client.PostAsync(confirmUrl, null);

        Assert.Equal(HttpStatusCode.Conflict, secondConfirm.StatusCode);
    }

    [Fact]
    public async Task Daily_Budget_Exceeded_Returns_402_Before_Calling_Gemini_Again()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();

        // Seed the daily budget's own ceiling directly rather than making
        // 20 real HTTP round trips through the rate limiter -- the point
        // of this test is the live COUNT check itself, not re-driving the
        // happy path 20 times over.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
            for (var i = 0; i < 20; i++)
            {
                db.GenerationRequests.Add(new GenerationRequest
                {
                    Id = Guid.NewGuid(),
                    WorkspaceId = user.WorkspaceId,
                    ProjectId = projectId,
                    UserPrompt = "filler",
                    Category = ArtGenCategory.Tile,
                    Status = GenerationStatus.Ready,
                    RequestedByUserId = user.UserId,
                    CreatedAt = DateTimeOffset.UtcNow,
                });
            }
            await db.SaveChangesAsync();
        }

        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation",
            new { userPrompt = "one too many", category = ArtGenCategory.Tile });

        Assert.Equal(HttpStatusCode.PaymentRequired, response.StatusCode);
        Assert.DoesNotContain(_factory.ArtGenerationClient.ExpandRequests, r => r.UserPrompt == "one too many");
    }

    [Fact]
    public async Task Get_Returns_The_Live_Status_And_Its_Variations_Once_Ready()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();
        var (requestId, variationId) = await SeedReadyRequestWithVariationAsync(user.WorkspaceId, projectId, user.UserId, TinyPngBytes, width: 16, height: 16);

        var response = await user.Client.GetAsync($"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{requestId}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<GenerationRequestResponse>())!;
        Assert.Equal(GenerationStatus.Ready, body.Status);
        var variation = Assert.Single(body.Variations);
        Assert.Equal(variationId, variation.Id);
        Assert.Equal(16, variation.Width);
        Assert.Equal(16, variation.Height);
        Assert.False(variation.Selected);
    }

    [Fact]
    public async Task Get_An_Unknown_Request_Id_Is_404()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();

        var response = await user.Client.GetAsync($"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Variation_Content_Serves_The_Real_Uploaded_Bytes()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();
        var (requestId, variationId) = await SeedReadyRequestWithVariationAsync(user.WorkspaceId, projectId, user.UserId, TinyPngBytes);

        var response = await user.Client.GetAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{requestId}/variations/{variationId}/content");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("image/png", response.Content.Headers.ContentType?.MediaType);
        var bytes = await response.Content.ReadAsByteArrayAsync();
        Assert.Equal(TinyPngBytes, bytes);
    }

    [Fact]
    public async Task Variation_Content_For_An_Unknown_Variation_Is_404()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();
        var (requestId, _) = await SeedReadyRequestWithVariationAsync(user.WorkspaceId, projectId, user.UserId, TinyPngBytes);

        var response = await user.Client.GetAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{requestId}/variations/{Guid.NewGuid()}/content");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Select_Promotes_The_Variation_Into_A_Real_Ready_Asset()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();
        var (requestId, variationId) = await SeedReadyRequestWithVariationAsync(user.WorkspaceId, projectId, user.UserId, TinyPngBytes, width: 8, height: 8);

        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{requestId}/variations/{variationId}/select",
            new { assetName = "moss-tile.png" });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var body = (await response.Content.ReadFromJsonAsync<SelectGenerationVariationResponse>())!;
        Assert.Equal("moss-tile.png", body.OriginalName);

        // Indistinguishable from a hand-uploaded asset from here on --
        // this session's own standing "additive, not a separate pipeline"
        // constraint, made concrete: GetAssetContent serves it exactly
        // like any other Ready asset's real content.
        var contentResponse = await user.Client.GetAsync($"/api/v1/workspaces/{user.WorkspaceId}/assets/content/moss-tile.png");
        Assert.Equal(HttpStatusCode.OK, contentResponse.StatusCode);
        Assert.Equal(TinyPngBytes, await contentResponse.Content.ReadAsByteArrayAsync());

        var listResponse = await user.Client.GetAsync($"/api/v1/workspaces/{user.WorkspaceId}/assets");
        var list = (await listResponse.Content.ReadFromJsonAsync<Forge.Api.Features.Assets.AssetListResponse>())!;
        var asset = Assert.Single(list.Assets, a => a.Id == body.AssetId);
        Assert.Equal(AssetStatus.Ready, asset.Status);
        Assert.Equal(8, asset.Width);
        Assert.Equal(8, asset.Height);

        var pollResponse = await user.Client.GetAsync($"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{requestId}");
        var polled = (await pollResponse.Content.ReadFromJsonAsync<GenerationRequestResponse>())!;
        Assert.True(Assert.Single(polled.Variations).Selected);
    }

    [Fact]
    public async Task Selecting_Before_The_Request_Is_Ready_Is_A_Conflict()
    {
        // The narrow real race SeedRequestWithVariationAsync's own doc
        // comment describes: a variation row already exists (as it would
        // mid-way through MarkReadyAsync) but the request's Status hasn't
        // reached Ready yet.
        var (user, projectId) = await CreateProUserWithProjectAsync();
        var (requestId, variationId) = await SeedRequestWithVariationAsync(
            user.WorkspaceId, projectId, user.UserId, TinyPngBytes, GenerationStatus.Generating);

        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{requestId}/variations/{variationId}/select",
            new { assetName = "too-early.png" });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Selecting_A_Variation_That_Does_Not_Exist_On_This_Request_Is_404()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();
        var (requestId, _) = await SeedReadyRequestWithVariationAsync(user.WorkspaceId, projectId, user.UserId, TinyPngBytes);

        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{requestId}/variations/{Guid.NewGuid()}/select",
            new { assetName = "wrong-id.png" });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Selecting_An_Empty_Asset_Name_Is_A_Validation_Problem()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();
        var (requestId, variationId) = await SeedReadyRequestWithVariationAsync(user.WorkspaceId, projectId, user.UserId, TinyPngBytes);

        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{requestId}/variations/{variationId}/select",
            new { assetName = "" });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Selecting_The_Same_Bytes_Twice_Dedupes_Onto_The_Existing_Asset_Rather_Than_Violating_The_Sha256_Index()
    {
        var (user, projectId) = await CreateProUserWithProjectAsync();
        var (firstRequestId, firstVariationId) = await SeedReadyRequestWithVariationAsync(user.WorkspaceId, projectId, user.UserId, TinyPngBytes);
        var firstSelect = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{firstRequestId}/variations/{firstVariationId}/select",
            new { assetName = "first.png" });
        var firstBody = (await firstSelect.Content.ReadFromJsonAsync<SelectGenerationVariationResponse>())!;

        // A second, independent generation request that happens to
        // produce byte-identical content (TinyPngBytes again) -- the same
        // real scenario ux_assets_workspace_sha256 exists to dedupe for a
        // hand upload.
        var (secondRequestId, secondVariationId) = await SeedReadyRequestWithVariationAsync(user.WorkspaceId, projectId, user.UserId, TinyPngBytes);

        var secondSelect = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects/{projectId}/art-generation/{secondRequestId}/variations/{secondVariationId}/select",
            new { assetName = "second.png" });

        Assert.Equal(HttpStatusCode.Created, secondSelect.StatusCode);
        var secondBody = (await secondSelect.Content.ReadFromJsonAsync<SelectGenerationVariationResponse>())!;
        Assert.Equal(firstBody.AssetId, secondBody.AssetId);
        Assert.Equal("first.png", secondBody.OriginalName); // the existing row's own name, not silently renamed.
    }
}
