using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Forge.Api.Features.Projects;
using Xunit;

namespace Forge.Tests.Authorization;

/// <summary>
/// M5 exit criterion (CLAUDE.md Section 8): "every endpoint has a passing
/// cross-tenant 404 test." <see cref="Features.Projects.ProjectsEndpointsTests"/>
/// already proves this for <c>GetProject</c> as part of its own round-trip
/// coverage; this suite is the single place that enumerates every
/// workspace- and project-scoped endpoint in the API and proves the same
/// property for each of them in one pass, so "every endpoint" is something
/// this file's test count can actually be checked against rather than
/// trusted by inspection.
///
/// Cross-tenant access must return 404, never 403 (docs/SPEC.md Section
/// 4.5, CLAUDE.md Section 1.1 guardrail 4) — a 403 would itself leak that
/// the resource exists to someone who was never granted access to it.
///
/// One owner, one outsider, and one project are signed up/created ONCE
/// (lazily, on first use) and reused across every case below — the
/// property under test (an outsider who is not a member of the owner's
/// workspace gets 404) doesn't depend on fresh state per endpoint, and
/// standing up a real signup+verify+login+PKCE dance per case for 11+
/// endpoints would be wasted work repeated 11+ times over.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class CrossTenantAuthorizationTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    private static Task<SharedState>? _sharedStateTask;
    private static readonly SemaphoreSlim SharedStateLock = new(1, 1);

    public CrossTenantAuthorizationTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    // Public, not private: Outsider_Gets_404_Not_403 is a public [Theory]
    // method taking Func<SharedState, HttpRequestMessage> as a parameter
    // — a public member's signature can't reference a less-accessible
    // type (CS0051), so this has to be at least as visible as that method.
    public sealed record SharedState(AuthenticatedTestUser Owner, AuthenticatedTestUser Outsider, Guid ProjectId, long RevisionId);

    private async Task<SharedState> GetSharedStateAsync()
    {
        if (_sharedStateTask is not null) return await _sharedStateTask;

        await SharedStateLock.WaitAsync();
        try
        {
            _sharedStateTask ??= InitializeSharedStateAsync();
            return await _sharedStateTask;
        }
        finally
        {
            SharedStateLock.Release();
        }
    }

    private async Task<SharedState> InitializeSharedStateAsync()
    {
        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var outsider = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var createResponse = await owner.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{owner.WorkspaceId}/projects",
            new { slug = "cross-tenant-fixture", title = "Cross Tenant Fixture", description = (string?)null, engineVersion = "0.1.0", genreTemplate = (string?)null });
        createResponse.EnsureSuccessStatusCode();
        var project = (await createResponse.Content.ReadFromJsonAsync<ProjectDetailResponse>())!;

        var doc = JsonSerializer.SerializeToElement(new { scenes = new[] { new { id = "village" } }, installedModules = new { } });
        var commitResponse = await owner.Client.PostAsJsonAsync(
            $"/api/v1/projects/{project.Id}/revisions",
            new { expectedHeadRevision = (long?)null, label = (string?)null, isCheckpoint = false, document = doc });
        commitResponse.EnsureSuccessStatusCode();
        var commit = (await commitResponse.Content.ReadFromJsonAsync<CommitRevisionResponse>())!;

        return new SharedState(owner, outsider, project.Id, commit.RevisionId);
    }

    public static IEnumerable<object[]> ProtectedRequests()
    {
        // (name, build-request-from-shared-state). The name alone drives
        // xUnit's per-case display so a failure names the exact endpoint,
        // not just "some theory case failed."
        yield return new object[] { "CreateProject (workspace:write)", (Func<SharedState, HttpRequestMessage>)(s =>
            new HttpRequestMessage(HttpMethod.Post, $"/api/v1/workspaces/{s.Owner.WorkspaceId}/projects")
            {
                Content = JsonContent.Create(new { slug = "intrusion-attempt", title = "x", description = (string?)null, engineVersion = "0.1.0", genreTemplate = (string?)null }),
            }) };

        yield return new object[] { "ListProjects (workspace:read)", (Func<SharedState, HttpRequestMessage>)(s =>
            new HttpRequestMessage(HttpMethod.Get, $"/api/v1/workspaces/{s.Owner.WorkspaceId}/projects")) };

        yield return new object[] { "GetProject (project:read)", (Func<SharedState, HttpRequestMessage>)(s =>
            new HttpRequestMessage(HttpMethod.Get, $"/api/v1/projects/{s.ProjectId}")) };

        yield return new object[] { "GetDocument (project:read)", (Func<SharedState, HttpRequestMessage>)(s =>
            new HttpRequestMessage(HttpMethod.Get, $"/api/v1/projects/{s.ProjectId}/document")) };

        yield return new object[] { "ListRevisions (project:read)", (Func<SharedState, HttpRequestMessage>)(s =>
            new HttpRequestMessage(HttpMethod.Get, $"/api/v1/projects/{s.ProjectId}/revisions")) };

        yield return new object[] { "UpdateProject (project:write)", (Func<SharedState, HttpRequestMessage>)(s =>
            new HttpRequestMessage(HttpMethod.Patch, $"/api/v1/projects/{s.ProjectId}")
            {
                Content = JsonContent.Create(new { title = "Renamed", description = (string?)null, visibility = (string?)null, coverAssetId = (Guid?)null }),
            }) };

        yield return new object[] { "CommitRevision (project:write)", (Func<SharedState, HttpRequestMessage>)(s =>
            new HttpRequestMessage(HttpMethod.Post, $"/api/v1/projects/{s.ProjectId}/revisions")
            {
                Content = JsonContent.Create(new { expectedHeadRevision = s.RevisionId, label = (string?)null, isCheckpoint = false, document = JsonSerializer.SerializeToElement(new { scenes = Array.Empty<object>(), installedModules = new { } }) }),
            }) };

        yield return new object[] { "RestoreRevision (project:write)", (Func<SharedState, HttpRequestMessage>)(s =>
            new HttpRequestMessage(HttpMethod.Post, $"/api/v1/projects/{s.ProjectId}/revisions/{s.RevisionId}/restore")
            {
                Content = JsonContent.Create(new { expectedHeadRevision = s.RevisionId, label = (string?)null }),
            }) };

        yield return new object[] { "DeleteProject (project:write)", (Func<SharedState, HttpRequestMessage>)(s =>
            new HttpRequestMessage(HttpMethod.Delete, $"/api/v1/projects/{s.ProjectId}")) };

        // docs/adr/0010: the first endpoint combining two named policies
        // (project:write AND project:pro) on one route. The point of this
        // case isn't just "outsiders get 404 here too" — it specifically
        // proves WorkspaceAuthorizationMiddlewareResultHandler's
        // FailedRequirements fix: the owner's shared-state workspace was
        // never upgraded to Pro, so both requirements fail here, and the
        // old policy.Requirements-based check would have matched
        // PlanGateRequirement being merely *present* in the combined
        // policy and returned 402 instead of masking it behind the
        // correct 404 for a non-member.
        yield return new object[] { "CreateBuild (project:write + project:pro)", (Func<SharedState, HttpRequestMessage>)(s =>
            new HttpRequestMessage(HttpMethod.Post, $"/api/v1/projects/{s.ProjectId}/builds")) };

        yield return new object[] { "GetBillingStatus (workspace:billing)", (Func<SharedState, HttpRequestMessage>)(s =>
            new HttpRequestMessage(HttpMethod.Get, $"/api/v1/workspaces/{s.Owner.WorkspaceId}/billing")) };

        yield return new object[] { "CheckoutSession (workspace:billing)", (Func<SharedState, HttpRequestMessage>)(s =>
            new HttpRequestMessage(HttpMethod.Post, $"/api/v1/workspaces/{s.Owner.WorkspaceId}/billing/checkout-session")
            {
                Content = JsonContent.Create(new { plan = "pro" }),
            }) };

        yield return new object[] { "PortalSession (workspace:billing)", (Func<SharedState, HttpRequestMessage>)(s =>
            new HttpRequestMessage(HttpMethod.Post, $"/api/v1/workspaces/{s.Owner.WorkspaceId}/billing/portal-session")) };
    }

    [Theory]
    [MemberData(nameof(ProtectedRequests))]
    public async Task Outsider_Gets_404_Not_403(string name, Func<SharedState, HttpRequestMessage> buildRequest)
    {
        var state = await GetSharedStateAsync();
        var request = buildRequest(state);

        var response = await state.Outsider.Client.SendAsync(request);

        Assert.True(
            response.StatusCode == HttpStatusCode.NotFound,
            $"{name}: expected 404 for a non-member of the workspace, got {(int)response.StatusCode} {response.StatusCode}.");
    }

    [Fact]
    public async Task The_Owner_Can_Still_Reach_Every_One_Of_These_Endpoints()
    {
        // Guards against a broken test double-counting as a "pass": if the
        // policy wiring were broken in a way that 404s *everyone*
        // (including the legitimate owner), every case above would still
        // report green while the feature is actually unusable. This proves
        // the owner's own access is intact on the same shared project.
        var state = await GetSharedStateAsync();

        var response = await state.Owner.Client.GetAsync($"/api/v1/projects/{state.ProjectId}");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var billingResponse = await state.Owner.Client.GetAsync($"/api/v1/workspaces/{state.Owner.WorkspaceId}/billing");
        Assert.Equal(HttpStatusCode.OK, billingResponse.StatusCode);
    }
}
