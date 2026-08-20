using System.Net;
using System.Net.Http.Json;
using Forge.Api.Features.ArtGeneration;
using Forge.Api.Features.Projects;
using Forge.Domain.Entities;
using Forge.Infrastructure.ArtGeneration;
using Forge.Infrastructure.Persistence;
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
/// ⚠ Not run in this sandbox: Docker/Testcontainers is unavailable here
/// (this session's own environment — dockerd did not come up). Verified
/// when CI runs on a GitHub-hosted runner with Docker available, the same
/// as every other Testcontainers-backed suite in this project.
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
}
