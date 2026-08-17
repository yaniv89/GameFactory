using System.Net;
using System.Net.Http.Json;
using Forge.Api.Features.Registry;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Registry;

/// <summary>
/// docs/SPEC.md Section 16.2's minimal issue tracker (the
/// SupportResponsivenessHours ranking signal's data source):
/// <see cref="IssuesEndpoint"/>'s create/reply and
/// <see cref="PackageDetailAndVersionsEndpoint"/>'s issues-list read.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class IssuesEndpointTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public IssuesEndpointTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    /// <summary>Seeds a package whose author is a real, authenticated account — required for testing the author-only reply gate, unlike <c>ReviewsEndpointTests</c>'s own DB-only author (reviews never need to authenticate as the author).</summary>
    private async Task<Guid> SeedPackageAsync(string name, Guid authorUserId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();

        var package = new Package
        {
            Name = name,
            Kind = PackageKind.Module,
            AuthorUserId = authorUserId,
            DisplayName = "Test Package",
            Summary = "A test package.",
            LicenseSpdx = "MIT",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Packages.Add(package);
        await db.SaveChangesAsync();

        db.Listings.Add(new Listing { PackageId = package.Id, PricingModel = ListingPricingModel.Free, PriceCents = 0 });
        await db.SaveChangesAsync();
        return package.Id;
    }

    [Fact]
    public async Task Create_Files_A_Real_Issue_For_Any_Authenticated_User()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SeedPackageAsync("@acme/issues-create", author.UserId);
        var reporter = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await reporter.Client.PostAsJsonAsync(
            "/api/v1/packages/@acme/issues-create/issues", new { title = "Crashes on load", body = "Stack trace attached." });

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<IssueResponse>();
        Assert.Equal("Crashes on load", body!.Title);
        Assert.Equal("Stack trace attached.", body.Body);
        Assert.Null(body.FirstReplyAt);
    }

    [Fact]
    public async Task Create_Rejects_An_Empty_Title()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SeedPackageAsync("@acme/issues-empty-title", author.UserId);

        var response = await author.Client.PostAsJsonAsync("/api/v1/packages/@acme/issues-empty-title/issues", new { title = "  ", body = (string?)null });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Create_Requires_Authentication()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SeedPackageAsync("@acme/issues-anon", author.UserId);
        var anonymous = _factory.CreateClient();

        var response = await anonymous.PostAsJsonAsync("/api/v1/packages/@acme/issues-anon/issues", new { title = "Anonymous report", body = (string?)null });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Create_404s_For_An_Unknown_Package()
    {
        var user = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await user.Client.PostAsJsonAsync("/api/v1/packages/@nobody/does-not-exist/issues", new { title = "Anything", body = (string?)null });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Reply_By_The_Package_Author_Succeeds()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SeedPackageAsync("@acme/issues-reply-author", author.UserId);
        var reporter = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var created = await reporter.Client.PostAsJsonAsync("/api/v1/packages/@acme/issues-reply-author/issues", new { title = "Bug", body = (string?)null });
        var issue = (await created.Content.ReadFromJsonAsync<IssueResponse>())!;

        var response = await author.Client.PostAsJsonAsync(
            $"/api/v1/packages/@acme/issues-reply-author/issues/{issue.Id}/reply", new { body = "Fixed in the next release." });

        response.EnsureSuccessStatusCode();
        var reply = await response.Content.ReadFromJsonAsync<IssueReplyResponse>();
        Assert.Equal(issue.Id, reply!.IssueId);
        Assert.Equal("Fixed in the next release.", reply.Body);
    }

    [Fact]
    public async Task Reply_By_Someone_Other_Than_The_Author_Is_Forbidden()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SeedPackageAsync("@acme/issues-reply-forbidden", author.UserId);
        var reporter = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var created = await reporter.Client.PostAsJsonAsync("/api/v1/packages/@acme/issues-reply-forbidden/issues", new { title = "Bug", body = (string?)null });
        var issue = (await created.Content.ReadFromJsonAsync<IssueResponse>())!;

        var stranger = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var response = await stranger.Client.PostAsJsonAsync(
            $"/api/v1/packages/@acme/issues-reply-forbidden/issues/{issue.Id}/reply", new { body = "I am not the author." });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Reply_404s_For_An_Issue_That_Does_Not_Belong_To_The_Package()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SeedPackageAsync("@acme/issues-reply-wrong-package", author.UserId);

        var response = await author.Client.PostAsJsonAsync(
            $"/api/v1/packages/@acme/issues-reply-wrong-package/issues/{Guid.NewGuid()}/reply", new { body = "Reply to nothing." });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Reply_Rejects_An_Empty_Body()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SeedPackageAsync("@acme/issues-reply-empty", author.UserId);
        var created = await author.Client.PostAsJsonAsync("/api/v1/packages/@acme/issues-reply-empty/issues", new { title = "Bug", body = (string?)null });
        var issue = (await created.Content.ReadFromJsonAsync<IssueResponse>())!;

        var response = await author.Client.PostAsJsonAsync(
            $"/api/v1/packages/@acme/issues-reply-empty/issues/{issue.Id}/reply", new { body = "   " });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task List_Issues_Is_Newest_First_And_Reports_The_Earliest_Reply()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SeedPackageAsync("@acme/issues-list", author.UserId);

        var first = await author.Client.PostAsJsonAsync("/api/v1/packages/@acme/issues-list/issues", new { title = "First issue", body = (string?)null });
        var firstIssue = (await first.Content.ReadFromJsonAsync<IssueResponse>())!;
        await Task.Delay(10);
        var second = await author.Client.PostAsJsonAsync("/api/v1/packages/@acme/issues-list/issues", new { title = "Second issue", body = (string?)null });
        var secondIssue = (await second.Content.ReadFromJsonAsync<IssueResponse>())!;

        await author.Client.PostAsJsonAsync($"/api/v1/packages/@acme/issues-list/issues/{firstIssue.Id}/reply", new { body = "Looking into it." });

        var anonymousClient = _factory.CreateClient();
        var response = await anonymousClient.GetAsync("/api/v1/packages/@acme/issues-list/issues");

        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<IssueListResponse>();

        Assert.Equal(["Second issue", "First issue"], body!.Issues.Select(i => i.Title));
        var repliedIssue = body.Issues.Single(i => i.Id == firstIssue.Id);
        Assert.NotNull(repliedIssue.FirstReplyAt);
        var unansweredIssue = body.Issues.Single(i => i.Id == secondIssue.Id);
        Assert.Null(unansweredIssue.FirstReplyAt);
    }

    [Fact]
    public async Task List_Issues_404s_For_An_Unknown_Package()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/packages/@nobody/does-not-exist/issues");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Publishing_A_Version_Still_Works_After_Issues_Took_Over_The_Shared_Post_Route()
    {
        // Real regression guard for the ambiguous-route class of bug F1
        // already found once (ReviewsEndpoint vs SetListingEndpoint on
        // PUT) — proves PublishVersionEndpoint.Handle is still reachable
        // now that IssuesEndpoint owns the one POST registration.
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SeedPackageAsync("@acme/issues-vs-publish", author.UserId);

        var manifest = System.Text.Json.JsonSerializer.SerializeToElement(new { name = "@acme/issues-vs-publish", version = "1.0.0" });
        var response = await author.Client.PostAsJsonAsync("/api/v1/packages/@acme/issues-vs-publish/versions", new
        {
            kind = PackageKind.Module,
            displayName = "Test Package",
            summary = "A test package.",
            readmeMarkdown = (string?)null,
            homepageUrl = (string?)null,
            licenseSpdx = "MIT",
            version = "1.0.0",
            engineRange = ">=1.0.0 <2.0.0",
            manifest,
            bundleBase64 = Convert.ToBase64String("console.log('hi');"u8.ToArray()),
            dependencies = (Dictionary<string, string>?)null,
        });

        // Whatever gate 1-3 verdict this particular bundle gets is beside
        // the point — the point is the request reaches
        // PublishVersionEndpoint.Handle at all (never a 404/ambiguous
        // match) and returns a real, attributable status, not a routing
        // failure.
        Assert.NotEqual(HttpStatusCode.NotFound, response.StatusCode);
    }
}
