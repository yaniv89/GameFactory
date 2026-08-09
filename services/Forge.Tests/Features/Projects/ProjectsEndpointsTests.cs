using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Forge.Api.Features.Projects;
using Xunit;

namespace Forge.Tests.Features.Projects;

/// <summary>
/// Drives the real M5 Phase 3 endpoint surface through a real HTTP
/// client against the real host, the same way <see cref="Auth.AuthFlowTests"/>
/// does for auth — nothing mocked except the email transport. Each test
/// signs up its own user (and therefore its own workspace) via
/// <see cref="AuthTestHelper"/> rather than sharing state across tests,
/// since <see cref="ForgeWebApplicationFactory"/> is one shared fixture
/// for the whole class.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class ProjectsEndpointsTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public ProjectsEndpointsTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private static JsonElement Doc(params string[] sceneIds)
    {
        var scenes = sceneIds.Select(id => new { id }).ToArray();
        return JsonSerializer.SerializeToElement(new { scenes, installedModules = new { } });
    }

    private async Task<ProjectDetailResponse> CreateProjectAsync(AuthenticatedTestUser user, string slug = "two-room-rpg")
    {
        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects",
            new { slug, title = "Two Room RPG", description = (string?)null, engineVersion = "0.1.0", genreTemplate = (string?)null });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ProjectDetailResponse>())!;
    }

    [Fact]
    public async Task Create_Then_Get_Then_List_Round_Trip()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var created = await CreateProjectAsync(user);

        Assert.Equal(user.WorkspaceId, created.WorkspaceId);
        Assert.Equal("two-room-rpg", created.Slug);
        Assert.Null(created.HeadRevision);

        var getResponse = await user.Client.GetAsync($"/api/v1/projects/{created.Id}");
        Assert.Equal(HttpStatusCode.OK, getResponse.StatusCode);
        var fetched = await getResponse.Content.ReadFromJsonAsync<ProjectDetailResponse>();
        Assert.Equal(created.Id, fetched!.Id);

        var listResponse = await user.Client.GetAsync($"/api/v1/workspaces/{user.WorkspaceId}/projects");
        var list = await listResponse.Content.ReadFromJsonAsync<List<ProjectSummaryResponse>>();
        Assert.Contains(list!, p => p.Id == created.Id);
    }

    [Fact]
    public async Task Create_With_Duplicate_Slug_In_Same_Workspace_Is_Rejected()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await CreateProjectAsync(user, "same-slug");

        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects",
            new { slug = "same-slug", title = "Another", description = (string?)null, engineVersion = "0.1.0", genreTemplate = (string?)null });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Create_With_Invalid_Slug_Is_A_Validation_Problem()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects",
            new { slug = "Not A Valid Slug!", title = "X", description = (string?)null, engineVersion = "0.1.0", genreTemplate = (string?)null });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Update_Changes_Title_And_Visibility()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var created = await CreateProjectAsync(user);

        var response = await user.Client.PatchAsJsonAsync(
            $"/api/v1/projects/{created.Id}",
            new { title = "Renamed", description = (string?)null, visibility = "unlisted", coverAssetId = (Guid?)null });
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.Content.ReadFromJsonAsync<ProjectDetailResponse>();

        Assert.Equal("Renamed", updated!.Title);
        Assert.Equal("unlisted", updated.Visibility);
    }

    [Fact]
    public async Task Update_With_Invalid_Visibility_Is_A_Validation_Problem()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var created = await CreateProjectAsync(user);

        var response = await user.Client.PatchAsJsonAsync(
            $"/api/v1/projects/{created.Id}",
            new { title = (string?)null, description = (string?)null, visibility = "super-public", coverAssetId = (Guid?)null });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Delete_Is_A_Soft_Delete_And_The_Project_Then_404s()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var created = await CreateProjectAsync(user);

        var deleteResponse = await user.Client.DeleteAsync($"/api/v1/projects/{created.Id}");
        Assert.Equal(HttpStatusCode.NoContent, deleteResponse.StatusCode);

        var getResponse = await user.Client.GetAsync($"/api/v1/projects/{created.Id}");
        Assert.Equal(HttpStatusCode.NotFound, getResponse.StatusCode);
    }

    [Fact]
    public async Task Commit_Revision_Sets_Head_And_Document_Is_Readable_Back()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var created = await CreateProjectAsync(user);

        var commitResponse = await user.Client.PostAsJsonAsync(
            $"/api/v1/projects/{created.Id}/revisions",
            new { expectedHeadRevision = (long?)null, label = "Initial checkpoint", isCheckpoint = true, document = Doc("village") });
        Assert.Equal(HttpStatusCode.Created, commitResponse.StatusCode);
        var commit = await commitResponse.Content.ReadFromJsonAsync<CommitRevisionResponse>();

        var projectResponse = await user.Client.GetAsync($"/api/v1/projects/{created.Id}");
        var project = await projectResponse.Content.ReadFromJsonAsync<ProjectDetailResponse>();
        Assert.Equal(commit!.RevisionId, project!.HeadRevision);

        var docResponse = await user.Client.GetAsync($"/api/v1/projects/{created.Id}/document");
        var doc = await docResponse.Content.ReadFromJsonAsync<ProjectDocumentResponse>();
        Assert.Equal(commit.RevisionId, doc!.RevisionId);
        Assert.Equal("village", doc.Document.GetProperty("scenes")[0].GetProperty("id").GetString());
    }

    [Fact]
    public async Task Commit_Revision_With_Stale_Expected_Head_Is_A_Conflict()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var created = await CreateProjectAsync(user);

        var first = await user.Client.PostAsJsonAsync(
            $"/api/v1/projects/{created.Id}/revisions",
            new { expectedHeadRevision = (long?)null, label = (string?)null, isCheckpoint = false, document = Doc("village") });
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);

        // Still claiming no head revision existed — the same stale
        // precondition a second author who loaded the project before the
        // first commit would send.
        var conflict = await user.Client.PostAsJsonAsync(
            $"/api/v1/projects/{created.Id}/revisions",
            new { expectedHeadRevision = (long?)null, label = (string?)null, isCheckpoint = false, document = Doc("cave") });
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
    }

    [Fact]
    public async Task Committing_The_Same_Document_Twice_Deduplicates_Instead_Of_Adding_A_Revision()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var created = await CreateProjectAsync(user);
        var doc = Doc("village");

        var first = await user.Client.PostAsJsonAsync(
            $"/api/v1/projects/{created.Id}/revisions",
            new { expectedHeadRevision = (long?)null, label = (string?)null, isCheckpoint = false, document = doc });
        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        var firstCommit = await first.Content.ReadFromJsonAsync<CommitRevisionResponse>();

        var second = await user.Client.PostAsJsonAsync(
            $"/api/v1/projects/{created.Id}/revisions",
            new { expectedHeadRevision = firstCommit!.RevisionId, label = (string?)null, isCheckpoint = false, document = doc });
        Assert.Equal(HttpStatusCode.OK, second.StatusCode); // 200, not 201: no new revision was created.
        var secondCommit = await second.Content.ReadFromJsonAsync<CommitRevisionResponse>();
        Assert.Equal(firstCommit.RevisionId, secondCommit!.RevisionId);
    }

    [Fact]
    public async Task Commit_Revision_Without_A_Scenes_Array_Is_A_Validation_Problem()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var created = await CreateProjectAsync(user);

        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/projects/{created.Id}/revisions",
            new { expectedHeadRevision = (long?)null, label = (string?)null, isCheckpoint = false, document = JsonSerializer.SerializeToElement(new { notScenes = true }) });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task List_Revisions_Paginates_With_A_Cursor()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var created = await CreateProjectAsync(user);

        long? head = null;
        for (var i = 0; i < 3; i++)
        {
            var response = await user.Client.PostAsJsonAsync(
                $"/api/v1/projects/{created.Id}/revisions",
                new { expectedHeadRevision = head, label = (string?)null, isCheckpoint = false, document = Doc($"scene-{i}") });
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
            head = (await response.Content.ReadFromJsonAsync<CommitRevisionResponse>())!.RevisionId;
        }

        var firstPageResponse = await user.Client.GetAsync($"/api/v1/projects/{created.Id}/revisions?limit=2");
        var firstPage = await firstPageResponse.Content.ReadFromJsonAsync<RevisionHistoryResponse>();
        Assert.Equal(2, firstPage!.Revisions.Count);
        Assert.NotNull(firstPage.NextCursor);

        var secondPageResponse = await user.Client.GetAsync($"/api/v1/projects/{created.Id}/revisions?limit=2&cursor={firstPage.NextCursor}");
        var secondPage = await secondPageResponse.Content.ReadFromJsonAsync<RevisionHistoryResponse>();
        Assert.Single(secondPage!.Revisions);
        Assert.Null(secondPage.NextCursor);

        // Newest first, and the two pages don't overlap.
        Assert.True(firstPage.Revisions[0].Id > firstPage.Revisions[1].Id);
        Assert.True(firstPage.Revisions[1].Id > secondPage.Revisions[0].Id);
    }

    [Fact]
    public async Task Restore_Commits_The_Old_Document_As_A_New_Head_Revision()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var created = await CreateProjectAsync(user);

        var firstCommitResponse = await user.Client.PostAsJsonAsync(
            $"/api/v1/projects/{created.Id}/revisions",
            new { expectedHeadRevision = (long?)null, label = (string?)null, isCheckpoint = false, document = Doc("village") });
        var firstCommit = await firstCommitResponse.Content.ReadFromJsonAsync<CommitRevisionResponse>();

        var secondCommitResponse = await user.Client.PostAsJsonAsync(
            $"/api/v1/projects/{created.Id}/revisions",
            new { expectedHeadRevision = firstCommit!.RevisionId, label = (string?)null, isCheckpoint = false, document = Doc("village", "cave") });
        var secondCommit = await secondCommitResponse.Content.ReadFromJsonAsync<CommitRevisionResponse>();

        var restoreResponse = await user.Client.PostAsJsonAsync(
            $"/api/v1/projects/{created.Id}/revisions/{firstCommit.RevisionId}/restore",
            new { expectedHeadRevision = secondCommit!.RevisionId, label = (string?)null });
        Assert.Equal(HttpStatusCode.Created, restoreResponse.StatusCode);
        var restoreCommit = await restoreResponse.Content.ReadFromJsonAsync<CommitRevisionResponse>();
        Assert.NotEqual(firstCommit.RevisionId, restoreCommit!.RevisionId); // A new revision, not a rewind.

        var docResponse = await user.Client.GetAsync($"/api/v1/projects/{created.Id}/document");
        var doc = await docResponse.Content.ReadFromJsonAsync<ProjectDocumentResponse>();
        Assert.Single(doc!.Document.GetProperty("scenes").EnumerateArray()); // Back to the one-scene document.
    }

    [Fact]
    public async Task A_Users_Project_Is_Invisible_To_A_Different_Workspaces_Member()
    {
        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var created = await CreateProjectAsync(owner);

        var outsider = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var response = await outsider.Client.GetAsync($"/api/v1/projects/{created.Id}");

        // Cross-tenant access returns 404, never 403 (docs/SPEC.md Section
        // 4.5) — a 403 would itself confirm the project exists.
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Unauthenticated_Request_Is_Rejected()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync($"/api/v1/workspaces/{Guid.NewGuid()}/projects");
        Assert.False(response.IsSuccessStatusCode);
    }
}
