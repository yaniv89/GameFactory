using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Forge.Api.Features.Marketplace;
using Forge.Api.Features.Projects;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Marketplace;

/// <summary>
/// The backend half of "install a purchased/free marketplace package into
/// a project" — <see cref="InstallEligibilityEndpoint"/>. Covers the
/// free/licensed gate (reusing <see cref="PurchaseCheckoutSessionEndpoint"/>'s
/// own license-check query, un-negated), the scan-status gate (only a
/// <see cref="PackageScanStatus.Passed"/> version is ever installable),
/// and that project access is resolved server-side from the caller's real
/// workspace membership — never a client-supplied identifier (CLAUDE.md
/// Section 1.1 guardrail 4).
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class InstallEligibilityEndpointTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public InstallEligibilityEndpointTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private static JsonElement EmptyManifest() => JsonSerializer.SerializeToElement(new { });

    private async Task<Guid> CreateProjectAsync(AuthenticatedTestUser user, string slug = "install-test-project")
    {
        var response = await user.Client.PostAsJsonAsync(
            $"/api/v1/workspaces/{user.WorkspaceId}/projects",
            new { slug, title = "Install Test Project", description = (string?)null, engineVersion = "0.1.0", genreTemplate = (string?)null });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = (await response.Content.ReadFromJsonAsync<ProjectDetailResponse>())!;
        return created.Id;
    }

    private async Task<(Guid PackageId, string PackageName)> SeedPackageWithListingAsync(Guid authorUserId, string pricingModel, int priceCents)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var name = $"@author/pkg-{Guid.NewGuid():N}";
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

        db.Listings.Add(new Listing { PackageId = package.Id, PricingModel = pricingModel, PriceCents = priceCents });
        await db.SaveChangesAsync();

        return (package.Id, name);
    }

    private async Task SeedVersionAsync(Guid packageId, string version, string scanStatus, DateTimeOffset? publishedAt = null)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        db.PackageVersions.Add(new PackageVersion
        {
            PackageId = packageId,
            Version = version,
            EngineRange = ">=1.0.0 <2.0.0",
            Manifest = EmptyManifest(),
            BundleUrl = $"https://cdn.forge.dev/packages/pkg/{version}/bundle.js",
            BundleSha256 = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(version)),
            SizeBytes = 1024,
            ScanStatus = scanStatus,
            PublishedAt = publishedAt ?? DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    private async Task SeedLicenseAsync(Guid packageId, Guid workspaceId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        db.Licenses.Add(new License
        {
            PackageId = packageId,
            WorkspaceId = workspaceId,
            GrantedVia = LicenseGrantedVia.Purchase,
            GrantedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }

    private async Task AddWorkspaceMemberAsync(Guid workspaceId, Guid userId, string role)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        db.WorkspaceMembers.Add(new WorkspaceMember { WorkspaceId = workspaceId, UserId = userId, Role = role, JoinedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task A_Free_Package_With_A_Passed_Version_Is_Installable_Without_A_License()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var (packageId, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.Free, 0);
        await SeedVersionAsync(packageId, "1.0.0", PackageScanStatus.Passed);

        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var projectId = await CreateProjectAsync(owner);

        var response = await owner.Client.GetAsync($"/api/v1/projects/{projectId}/marketplace-installable/{packageName}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<MarketplaceInstallableResponse>();
        Assert.Equal(packageName, body!.PackageName);
        Assert.Equal("1.0.0", body.Version);
        Assert.EndsWith("/1.0.0/bundle.js", body.BundleUrl);
        Assert.Equal(
            Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes("1.0.0"))),
            body.BundleSha256Hex);
    }

    [Fact]
    public async Task A_Paid_Package_Is_Installable_When_The_Projects_Workspace_Holds_A_License()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var (packageId, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.OneTime, 500);
        await SeedVersionAsync(packageId, "2.1.0", PackageScanStatus.Passed);

        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SeedLicenseAsync(packageId, owner.WorkspaceId);
        var projectId = await CreateProjectAsync(owner);

        var response = await owner.Client.GetAsync($"/api/v1/projects/{projectId}/marketplace-installable/{packageName}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<MarketplaceInstallableResponse>();
        Assert.Equal("2.1.0", body!.Version);
    }

    [Fact]
    public async Task A_Paid_Package_Is_Rejected_When_The_Projects_Workspace_Holds_No_License()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var (packageId, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.OneTime, 500);
        await SeedVersionAsync(packageId, "1.0.0", PackageScanStatus.Passed);

        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var projectId = await CreateProjectAsync(owner);

        var response = await owner.Client.GetAsync($"/api/v1/projects/{projectId}/marketplace-installable/{packageName}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_License_Held_By_A_Different_Workspace_Does_Not_Satisfy_This_Projects_Gate()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var (packageId, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.OneTime, 500);
        await SeedVersionAsync(packageId, "1.0.0", PackageScanStatus.Passed);

        var licensedElsewhere = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await SeedLicenseAsync(packageId, licensedElsewhere.WorkspaceId);

        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var projectId = await CreateProjectAsync(owner);

        var response = await owner.Client.GetAsync($"/api/v1/projects/{projectId}/marketplace-installable/{packageName}");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_Package_With_No_Passed_Version_Yet_Is_Rejected_With_An_Actionable_Error()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var (packageId, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.Free, 0);
        await SeedVersionAsync(packageId, "0.1.0", PackageScanStatus.Pending); // still awaiting gate 4.

        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var projectId = await CreateProjectAsync(owner);

        var response = await owner.Client.GetAsync($"/api/v1/projects/{projectId}/marketplace-installable/{packageName}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_Unknown_Package_Name_Is_404()
    {
        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var projectId = await CreateProjectAsync(owner);

        var response = await owner.Client.GetAsync($"/api/v1/projects/{projectId}/marketplace-installable/@nobody/does-not-exist");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task A_Project_In_Another_Workspace_The_Caller_Cannot_See_Is_404_Not_403()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var (packageId, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.Free, 0);
        await SeedVersionAsync(packageId, "1.0.0", PackageScanStatus.Passed);

        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var projectId = await CreateProjectAsync(owner);
        var stranger = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);

        var response = await stranger.Client.GetAsync($"/api/v1/projects/{projectId}/marketplace-installable/{packageName}");

        // Cross-tenant-shaped 404, not 403 (docs/SPEC.md Section 4.5) — the
        // project:write policy's own generic handling, not anything this
        // endpoint's Handle needed to implement itself.
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task A_Viewer_On_The_Projects_Workspace_Cannot_Install_A_Viewer_Is_Read_Only()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var (packageId, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.Free, 0);
        await SeedVersionAsync(packageId, "1.0.0", PackageScanStatus.Passed);

        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var projectId = await CreateProjectAsync(owner);
        var viewer = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        await AddWorkspaceMemberAsync(owner.WorkspaceId, viewer.UserId, WorkspaceRole.Viewer);

        var response = await viewer.Client.GetAsync($"/api/v1/projects/{projectId}/marketplace-installable/{packageName}");

        // Same 404-masking as any other role gate in this repo — a Viewer
        // can read the project (project:read would allow this GET) but
        // project:write requires Editor+, since installing a module is an
        // editing action (InstallEligibilityEndpoint's own doc comment).
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Picks_The_Latest_Passed_Version_When_Several_Exist()
    {
        var author = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var (packageId, packageName) = await SeedPackageWithListingAsync(author.UserId, ListingPricingModel.Free, 0);
        await SeedVersionAsync(packageId, "1.0.0", PackageScanStatus.Passed, DateTimeOffset.UtcNow.AddDays(-5));
        await SeedVersionAsync(packageId, "1.1.0", PackageScanStatus.Passed, DateTimeOffset.UtcNow.AddDays(-1));
        await SeedVersionAsync(packageId, "2.0.0", PackageScanStatus.Pending, DateTimeOffset.UtcNow); // newest, but not cleared yet.

        var owner = await AuthTestHelper.SignupAndAuthenticateAsync(_factory);
        var projectId = await CreateProjectAsync(owner);

        var response = await owner.Client.GetAsync($"/api/v1/projects/{projectId}/marketplace-installable/{packageName}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadFromJsonAsync<MarketplaceInstallableResponse>();
        Assert.Equal("1.1.0", body!.Version);
    }
}
