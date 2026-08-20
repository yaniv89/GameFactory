using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Forge.Api.Features.Builds;
using Forge.Api.Features.Projects;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Builds;

/// <summary>
/// docs/adr/0010 Decision 3, driven through a real HTTP client against
/// the real host, same idiom as <see cref="Projects.ProjectsEndpointsTests"/>.
/// This is the API-level half of the proof; <see cref="Authorization.CrossTenantAuthorizationTests"/>
/// covers the cross-tenant 404 case for the same endpoint separately, since
/// that suite exists specifically to enumerate every workspace/project-
/// scoped endpoint in one pass.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class BuildsEndpointsTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public BuildsEndpointsTests(ForgeWebApplicationFactory factory)
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
            new { slug = $"proj-{Guid.NewGuid():N}", title = "Buildable Project", description = (string?)null, engineVersion = "0.1.0", genreTemplate = (string?)null });
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ProjectDetailResponse>())!;
    }

    private static async Task<long> CommitRevisionAsync(AuthenticatedTestUser user, Guid projectId)
    {
        var doc = JsonSerializer.SerializeToElement(new { scenes = new[] { new { id = "village" } }, installedModules = new { } });
        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/projects/{projectId}/revisions",
            new { expectedHeadRevision = (long?)null, label = (string?)null, isCheckpoint = false, document = doc });
        response.EnsureSuccessStatusCode();
        var commit = (await response.Content.ReadFromJsonAsync<CommitRevisionResponse>())!;
        return commit.RevisionId;
    }

    [Fact]
    public async Task Free_Plan_Member_Gets_402_Not_404()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var project = await CreateProjectAsync(user);
        await CommitRevisionAsync(user, project.Id);

        var response = await user.Client.PostAsync($"/api/v1/projects/{project.Id}/builds", null);

        Assert.Equal(HttpStatusCode.PaymentRequired, response.StatusCode);
    }

    [Fact]
    public async Task Pro_Plan_Member_With_No_Committed_Revision_Gets_A_Clear_400()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var project = await CreateProjectAsync(user);
        await SetWorkspacePlanAsync(user.WorkspaceId, WorkspacePlan.Pro);

        var response = await user.Client.PostAsync($"/api/v1/projects/{project.Id}/builds", null);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Commit at least one revision", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Create_Then_Get_Then_List_Round_Trip()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var project = await CreateProjectAsync(user);
        var revisionId = await CommitRevisionAsync(user, project.Id);
        await SetWorkspacePlanAsync(user.WorkspaceId, WorkspacePlan.Pro);

        var createResponse = await user.Client.PostAsync($"/api/v1/projects/{project.Id}/builds", null);
        Assert.Equal(HttpStatusCode.Accepted, createResponse.StatusCode);
        var created = (await createResponse.Content.ReadFromJsonAsync<CreateBuildResponse>())!;
        Assert.Equal(BuildStatus.Queued, created.Status);

        var getResponse = await user.Client.GetAsync($"/api/v1/projects/{project.Id}/builds/{created.Id}");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var fetched = (await getResponse.Content.ReadFromJsonAsync<BuildStatusResponse>())!;
        Assert.Equal(created.Id, fetched.Id);
        Assert.Equal(revisionId, fetched.RevisionId);
        Assert.Equal(BuildStatus.Queued, fetched.Status);
        // Queued builds have no play URL yet — only Forge.Functions.Build
        // (C3) advancing this row to Ready would make one meaningful, and
        // GetBuildEndpoint only computes one for that status.
        Assert.Null(fetched.PlayUrl);
        Assert.Null(fetched.ErrorMessage);

        var listResponse = await user.Client.GetAsync($"/api/v1/projects/{project.Id}/builds");
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        var list = (await listResponse.Content.ReadFromJsonAsync<BuildListResponse>())!;
        Assert.Contains(list.Builds, b => b.Id == created.Id);
    }

    [Fact]
    public async Task Get_Nonexistent_Build_Under_A_Real_Project_Is_404()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var project = await CreateProjectAsync(user);

        var response = await user.Client.GetAsync($"/api/v1/projects/{project.Id}/builds/{Guid.NewGuid()}");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Ready_Build_Reports_A_Play_Url()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var project = await CreateProjectAsync(user);
        var revisionId = await CommitRevisionAsync(user, project.Id);
        await SetWorkspacePlanAsync(user.WorkspaceId, WorkspacePlan.Pro);

        var createResponse = await user.Client.PostAsync($"/api/v1/projects/{project.Id}/builds", null);
        var created = (await createResponse.Content.ReadFromJsonAsync<CreateBuildResponse>())!;

        // Simulates what Forge.Functions.Build (C3) will do — this test's
        // job is GetBuildEndpoint's own playUrl-construction logic, not
        // the worker, which doesn't exist yet.
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
            await db.Builds.Where(b => b.Id == created.Id).ExecuteUpdateAsync(s => s
                .SetProperty(b => b.Status, BuildStatus.Ready)
                .SetProperty(b => b.CompletedAt, DateTimeOffset.UtcNow));
        }

        var getResponse = await user.Client.GetAsync($"/api/v1/projects/{project.Id}/builds/{created.Id}");
        var fetched = (await getResponse.Content.ReadFromJsonAsync<BuildStatusResponse>())!;

        Assert.Equal(BuildStatus.Ready, fetched.Status);
        Assert.NotNull(fetched.PlayUrl);
        Assert.EndsWith($"/{created.Id}/", fetched.PlayUrl);
        Assert.Equal(revisionId, fetched.RevisionId);
    }
}
