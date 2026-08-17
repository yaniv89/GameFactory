using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Forge.Api.Features.Registry;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Registry;

/// <summary>
/// M6 Phase 1's read surface (docs/SPEC.md Section 13.2): list/search,
/// package detail, version list, version detail. No publish endpoint
/// exists yet (M6 Phase 2, alongside the security gates it can't be
/// built without) — every fixture here is seeded directly through
/// <see cref="ForgeDbContext"/>, the same shortcut
/// <see cref="Forge.Tests.LoadTests.ConcurrentEditorsLoadTests"/> already
/// takes for state no HTTP endpoint produces yet.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class RegistryEndpointsTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public RegistryEndpointsTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private static JsonElement EmptyManifest() => JsonSerializer.SerializeToElement(new { });

    private async Task<(Guid PackageId, Guid AuthorUserId)> SeedPackageAsync(
        string name, string kind = "module", string displayName = "Test Package", string summary = "A test package.", string? readmeMarkdown = null)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();

        var workspace = new Workspace { Slug = $"ws-{Guid.NewGuid():N}", Name = "Author Workspace", CreatedAt = DateTimeOffset.UtcNow };
        db.Workspaces.Add(workspace);
        await db.SaveChangesAsync();

        var author = new User
        {
            IdentitySubjectId = Guid.NewGuid().ToString(),
            Email = $"author-{Guid.NewGuid():N}@example.com",
            DisplayName = "Author",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.DomainUsers.Add(author);
        await db.SaveChangesAsync();

        var package = new Package
        {
            Name = name,
            Kind = kind,
            AuthorUserId = author.Id,
            DisplayName = displayName,
            Summary = summary,
            ReadmeMarkdown = readmeMarkdown,
            LicenseSpdx = "MIT",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Packages.Add(package);
        await db.SaveChangesAsync();

        // Every package gets a Listing the moment it's created (Listing's
        // own doc comment) — PublishVersionEndpoint always adds one
        // alongside the Package it creates. This hand-seeded fixture has
        // to uphold that same invariant, or GetPackageAsync's real
        // PricingModel/PriceCents join (G2) finds nothing to join against.
        db.Listings.Add(new Listing { PackageId = package.Id, PricingModel = ListingPricingModel.Free, PriceCents = 0 });
        await db.SaveChangesAsync();

        return (package.Id, author.Id);
    }

    private async Task<Guid> SeedVersionAsync(
        Guid packageId, string version, string scanStatus = PackageScanStatus.Passed,
        DateTimeOffset? yankedAt = null, string engineRange = ">=1.0.0 <2.0.0",
        int sizeBytes = 1024, double? measuredAverageTickMs = null, DateTimeOffset? publishedAt = null)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();

        var packageVersion = new PackageVersion
        {
            PackageId = packageId,
            Version = version,
            EngineRange = engineRange,
            Manifest = EmptyManifest(),
            BundleUrl = $"https://cdn.forge.dev/p/pkg/{version}/bundle.js",
            BundleSha256 = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(version)),
            SizeBytes = sizeBytes,
            ScanStatus = scanStatus,
            YankedAt = yankedAt,
            MeasuredAverageTickMs = measuredAverageTickMs,
            PublishedAt = publishedAt ?? DateTimeOffset.UtcNow,
        };
        db.PackageVersions.Add(packageVersion);
        await db.SaveChangesAsync();
        return packageVersion.Id;
    }

    [Fact]
    public async Task List_Filters_By_Kind_And_Reports_The_Latest_Non_Yanked_Version()
    {
        var (moduleId, _) = await SeedPackageAsync("@acme/farming-list-kind", kind: PackageKind.Module);
        var (packId, _) = await SeedPackageAsync("@acme/fantasy-pack-list-kind", kind: PackageKind.ArtPack);
        await SeedVersionAsync(moduleId, "1.0.0");
        await SeedVersionAsync(moduleId, "1.1.0");
        await SeedVersionAsync(moduleId, "1.2.0", yankedAt: DateTimeOffset.UtcNow); // yanked: never "latest"
        await SeedVersionAsync(packId, "1.0.0");

        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/packages?kind=module");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<PackageListResponse>();

        var farming = Assert.Single(body!.Packages, p => p.Name == "@acme/farming-list-kind");
        Assert.Equal("1.1.0", farming.LatestVersion);
        Assert.DoesNotContain(body.Packages, p => p.Name == "@acme/fantasy-pack-list-kind");
    }

    [Fact]
    public async Task List_Search_Matches_Display_Name_And_Summary_Case_Insensitively()
    {
        await SeedPackageAsync("@acme/weather-search", displayName: "Weather System", summary: "Adds seasons and rain.");
        await SeedPackageAsync("@acme/unrelated-search", displayName: "Something Else", summary: "Nothing to do with the query.");

        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/packages?q=weather");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<PackageListResponse>();

        Assert.Contains(body!.Packages, p => p.Name == "@acme/weather-search");
        Assert.DoesNotContain(body.Packages, p => p.Name == "@acme/unrelated-search");
    }

    [Fact]
    public async Task Get_Package_Handles_A_Scoped_Name_With_A_Slash()
    {
        await SeedPackageAsync("@forge/dialogue-detail");

        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/packages/@forge/dialogue-detail");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<PackageDetailResponse>();

        Assert.Equal("@forge/dialogue-detail", body!.Name);
    }

    [Fact]
    public async Task Get_Package_Reports_The_Free_Listing_Every_New_Package_Starts_With()
    {
        await SeedPackageAsync("@acme/pricing-free-default");

        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/packages/@acme/pricing-free-default");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<PackageDetailResponse>();

        Assert.Equal(ListingPricingModel.Free, body!.PricingModel);
        Assert.Equal(0, body.PriceCents);
    }

    [Fact]
    public async Task Get_Package_Reports_A_Real_Paid_Price_After_SetListing()
    {
        var (packageId, _) = await SeedPackageAsync("@acme/pricing-paid");
        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
            await db.Listings.Where(l => l.PackageId == packageId)
                .ExecuteUpdateAsync(s => s.SetProperty(l => l.PricingModel, ListingPricingModel.OneTime).SetProperty(l => l.PriceCents, 1299));
        }

        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/packages/@acme/pricing-paid");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<PackageDetailResponse>();

        Assert.Equal(ListingPricingModel.OneTime, body!.PricingModel);
        Assert.Equal(1299, body.PriceCents);
    }

    [Fact]
    public async Task Get_Package_404s_For_An_Unknown_Name()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/packages/@nobody/nothing-here");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task List_Versions_Is_Newest_First_And_404s_For_An_Unknown_Package()
    {
        var (packageId, _) = await SeedPackageAsync("@acme/versions-list");
        await SeedVersionAsync(packageId, "1.0.0");
        await Task.Delay(10); // PublishedAt ordering needs a real gap on some CI clock resolutions.
        await SeedVersionAsync(packageId, "1.1.0");

        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/packages/@acme/versions-list/versions");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<PackageVersionListResponse>();

        Assert.Equal(["1.1.0", "1.0.0"], body!.Versions.Select(v => v.Version));

        var missing = await client.GetAsync("/api/v1/packages/@acme/does-not-exist/versions");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Fact]
    public async Task Get_Version_Returns_The_Manifest_And_Hex_Encoded_Hash()
    {
        var (packageId, _) = await SeedPackageAsync("@acme/version-detail");
        await SeedVersionAsync(packageId, "2.0.0");

        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/packages/@acme/version-detail/versions/2.0.0");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<PackageVersionDetailResponse>();

        Assert.Equal("2.0.0", body!.Version);
        Assert.Matches("^[0-9A-F]+$", body.BundleSha256Hex);

        var missingVersion = await client.GetAsync("/api/v1/packages/@acme/version-detail/versions/9.9.9");
        Assert.Equal(HttpStatusCode.NotFound, missingVersion.StatusCode);
    }

    [Fact]
    public async Task Ranked_Sort_Puts_The_Better_Signaled_Package_First()
    {
        var (goodId, _) = await SeedPackageAsync(
            "@acme/ranked-good", displayName: "Good Package", readmeMarkdown: new string('a', 1500));
        await SeedVersionAsync(goodId, "1.0.0", sizeBytes: 1024, measuredAverageTickMs: 0.1, publishedAt: DateTimeOffset.UtcNow);

        var (poorId, _) = await SeedPackageAsync(
            "@acme/ranked-poor", displayName: "Poor Package", readmeMarkdown: null);
        await SeedVersionAsync(poorId, "1.0.0", sizeBytes: 4_500_000, measuredAverageTickMs: 1.9, publishedAt: DateTimeOffset.UtcNow.AddYears(-2));

        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/packages?sort=ranked");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<PackageListResponse>();

        var goodIndex = body!.Packages.ToList().FindIndex(p => p.Name == "@acme/ranked-good");
        var poorIndex = body.Packages.ToList().FindIndex(p => p.Name == "@acme/ranked-poor");
        Assert.True(goodIndex >= 0 && poorIndex >= 0, "Both seeded packages should appear in the ranked list.");
        Assert.True(goodIndex < poorIndex, "The better-signaled package should rank above the worse one.");
        Assert.Null(body.NextCursor); // Ranked mode never returns a cursor.
    }

    [Fact]
    public async Task Ranked_Sort_Excludes_Packages_With_No_Passed_Version()
    {
        var (neverPassedId, _) = await SeedPackageAsync("@acme/ranked-never-passed");
        await SeedVersionAsync(neverPassedId, "1.0.0", scanStatus: PackageScanStatus.Pending);

        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/packages?sort=ranked");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<PackageListResponse>();

        Assert.DoesNotContain(body!.Packages, p => p.Name == "@acme/ranked-never-passed");
    }

    [Fact]
    public async Task Ranked_Sort_Rejects_A_Cursor()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/packages?sort=ranked&cursor=@acme/whatever");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task An_Unknown_Sort_Value_Is_A_Validation_Problem()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/packages?sort=popularity");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>F1: proves ActiveInstalls30d/BayesianRating are wired from real <see cref="License"/>/<see cref="Review"/> rows, not the null placeholders M7 Phase 6 shipped with.</summary>
    [Fact]
    public async Task Ranked_Sort_Rewards_Real_Installs_And_Ratings_Over_An_Otherwise_Identical_Package()
    {
        var (installedId, _) = await SeedPackageAsync(
            "@acme/ranked-installed-rated", displayName: "Installed And Rated", readmeMarkdown: new string('a', 1500));
        await SeedVersionAsync(installedId, "1.0.0", sizeBytes: 1024, measuredAverageTickMs: 0.1, publishedAt: DateTimeOffset.UtcNow);

        var (bareId, _) = await SeedPackageAsync(
            "@acme/ranked-bare", displayName: "Bare", readmeMarkdown: new string('a', 1500));
        await SeedVersionAsync(bareId, "1.0.0", sizeBytes: 1024, measuredAverageTickMs: 0.1, publishedAt: DateTimeOffset.UtcNow);

        using (var scope = _factory.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
            for (var i = 0; i < 5; i++)
            {
                var workspace = new Workspace { Slug = $"ws-install-{Guid.NewGuid():N}", Name = "Installer Workspace", CreatedAt = DateTimeOffset.UtcNow };
                db.Workspaces.Add(workspace);
                await db.SaveChangesAsync();
                db.Licenses.Add(new License
                {
                    PackageId = installedId,
                    WorkspaceId = workspace.Id,
                    GrantedVia = LicenseGrantedVia.Purchase,
                    GrantedAt = DateTimeOffset.UtcNow,
                });

                var reviewer = new User
                {
                    IdentitySubjectId = Guid.NewGuid().ToString(),
                    Email = $"reviewer-{Guid.NewGuid():N}@example.com",
                    DisplayName = "Reviewer",
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow,
                };
                db.DomainUsers.Add(reviewer);
                await db.SaveChangesAsync();
                db.Reviews.Add(new Review { PackageId = installedId, UserId = reviewer.Id, Rating = 5, CreatedAt = DateTimeOffset.UtcNow });
            }
            await db.SaveChangesAsync();
        }

        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/packages?sort=ranked");
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<PackageListResponse>();

        var installedIndex = body!.Packages.ToList().FindIndex(p => p.Name == "@acme/ranked-installed-rated");
        var bareIndex = body.Packages.ToList().FindIndex(p => p.Name == "@acme/ranked-bare");
        Assert.True(installedIndex >= 0 && bareIndex >= 0, "Both seeded packages should appear in the ranked list.");
        Assert.True(installedIndex < bareIndex, "Real installs and a real 5-star rating should outrank an otherwise-identical package with neither.");
    }
}
