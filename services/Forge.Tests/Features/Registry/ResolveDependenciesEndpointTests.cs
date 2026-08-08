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
/// docs/SPEC.md Section 13.4, exercised through the real
/// <c>POST /api/v1/registry/resolve</c> endpoint (not the resolver class
/// directly) so authentication and the malformed-input-&gt;400 path are
/// covered too, not just the resolution algorithm.
///
/// Every test uses its own uniquely-named packages: <see cref="IDependencyResolver"/>'s
/// candidate list is cached (5 minutes, process-wide) keyed by package
/// name, and <see cref="ForgeWebApplicationFactory"/> is one shared
/// fixture for every test in this class — reusing a name across tests
/// would let one test's seed data leak into another's cache entry.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class ResolveDependenciesEndpointTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public ResolveDependenciesEndpointTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private async Task SeedAsync(Action<ForgeDbContext> seed)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        seed(db);
        await db.SaveChangesAsync();
    }

    private static (Package Package, User Author, Workspace Workspace) NewPackage(string name, string kind = PackageKind.Module)
    {
        var workspace = new Workspace { Slug = $"ws-{Guid.NewGuid():N}", Name = "Author Workspace", CreatedAt = DateTimeOffset.UtcNow };
        var author = new User
        {
            IdentitySubjectId = Guid.NewGuid().ToString(),
            Email = $"author-{Guid.NewGuid():N}@example.com",
            DisplayName = "Author",
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        var package = new Package
        {
            Name = name,
            Kind = kind,
            AuthorUserId = author.Id,
            Author = author,
            DisplayName = name,
            Summary = "Test fixture.",
            LicenseSpdx = "MIT",
            CreatedAt = DateTimeOffset.UtcNow,
        };
        return (package, author, workspace);
    }

    private static PackageVersion NewVersion(
        Guid packageId, string version, string engineRange = ">=1.0.0 <2.0.0",
        string scanStatus = PackageScanStatus.Passed, DateTimeOffset? yankedAt = null,
        IReadOnlyDictionary<string, string>? dependencies = null)
    {
        var pv = new PackageVersion
        {
            PackageId = packageId,
            Version = version,
            EngineRange = engineRange,
            Manifest = JsonSerializer.SerializeToElement(new { }),
            BundleUrl = $"https://cdn.forge.dev/p/{packageId}/{version}/bundle.js",
            BundleSha256 = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes($"{packageId}@{version}")),
            SizeBytes = 2048,
            ScanStatus = scanStatus,
            YankedAt = yankedAt,
            PublishedAt = DateTimeOffset.UtcNow,
        };
        if (dependencies is not null)
        {
            foreach (var (depName, range) in dependencies)
            {
                // VersionId is deliberately left unset (defaults to
                // Guid.Empty, same as pv.Id at this point — neither is
                // real yet since neither row has been saved). EF Core
                // treats a foreign key left at its CLR default as "not
                // yet assigned" and fixes it up from this navigation
                // relationship once pv.Id is populated by SaveChangesAsync,
                // rather than actually writing Guid.Empty.
                pv.Dependencies.Add(new PackageDependency { DependsOnName = depName, VersionRange = range });
            }
        }
        return pv;
    }

    private async Task<HttpClient> AuthenticatedClientAsync() => (await AuthTestHelper.SignupAndAuthenticateAsync(_factory)).Client;

    [Fact]
    public async Task Resolves_A_Simple_Dependency_To_The_Highest_Satisfying_Version()
    {
        var (pkg, _, ws) = NewPackage("@acme/simple-resolve");
        await SeedAsync(db =>
        {
            db.Workspaces.Add(ws);
            db.DomainUsers.Add(pkg.Author!);
            db.Packages.Add(pkg);
        });
        var v1 = NewVersion(pkg.Id, "1.0.0");
        var v2 = NewVersion(pkg.Id, "1.5.0");
        await SeedAsync(db => db.PackageVersions.AddRange(v1, v2));

        var client = await AuthenticatedClientAsync();
        var response = await client.PostAsJsonAsync("/api/v1/registry/resolve", new
        {
            engineVersion = "1.0.0",
            dependencies = new Dictionary<string, string> { ["@acme/simple-resolve"] = "^1.0.0" },
            pinned = (Dictionary<string, string>?)null,
        });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<ResolveResponse>();

        var resolved = Assert.Single(body!.Resolved, kv => kv.Key == "@acme/simple-resolve").Value;
        Assert.Equal("1.5.0", resolved.Version);
        Assert.StartsWith("sha256-", resolved.Integrity);
        Assert.Empty(body.Warnings);
    }

    [Fact]
    public async Task Resolves_Transitive_Dependencies()
    {
        var (a, _, wsA) = NewPackage("@acme/transitive-a");
        var (b, _, wsB) = NewPackage("@acme/transitive-b");
        await SeedAsync(db =>
        {
            db.Workspaces.AddRange(wsA, wsB);
            db.DomainUsers.AddRange(a.Author!, b.Author!);
            db.Packages.AddRange(a, b);
        });
        var bVersion = NewVersion(b.Id, "1.0.0");
        await SeedAsync(db => db.PackageVersions.Add(bVersion));
        var aVersion = NewVersion(a.Id, "1.0.0", dependencies: new Dictionary<string, string> { ["@acme/transitive-b"] = "^1.0.0" });
        await SeedAsync(db => db.PackageVersions.Add(aVersion));

        var client = await AuthenticatedClientAsync();
        var response = await client.PostAsJsonAsync("/api/v1/registry/resolve", new
        {
            engineVersion = "1.0.0",
            dependencies = new Dictionary<string, string> { ["@acme/transitive-a"] = "^1.0.0" },
            pinned = (Dictionary<string, string>?)null,
        });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<ResolveResponse>();

        Assert.Contains("@acme/transitive-a", body!.Resolved.Keys);
        Assert.Contains("@acme/transitive-b", body.Resolved.Keys);
    }

    [Fact]
    public async Task A_Pin_Overrides_The_Highest_Satisfying_Version()
    {
        var (pkg, _, ws) = NewPackage("@acme/pinned-resolve");
        await SeedAsync(db =>
        {
            db.Workspaces.Add(ws);
            db.DomainUsers.Add(pkg.Author!);
            db.Packages.Add(pkg);
        });
        await SeedAsync(db => db.PackageVersions.AddRange(NewVersion(pkg.Id, "1.0.0"), NewVersion(pkg.Id, "1.5.0")));

        var client = await AuthenticatedClientAsync();
        var response = await client.PostAsJsonAsync("/api/v1/registry/resolve", new
        {
            engineVersion = "1.0.0",
            dependencies = new Dictionary<string, string> { ["@acme/pinned-resolve"] = "^1.0.0" },
            pinned = new Dictionary<string, string> { ["@acme/pinned-resolve"] = "1.0.0" },
        });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<ResolveResponse>();

        Assert.Equal("1.0.0", body!.Resolved["@acme/pinned-resolve"].Version);
    }

    [Fact]
    public async Task Falls_Back_To_A_Yanked_Version_With_A_Warning_When_Nothing_Else_Satisfies()
    {
        var (pkg, _, ws) = NewPackage("@acme/yanked-only-resolve");
        await SeedAsync(db =>
        {
            db.Workspaces.Add(ws);
            db.DomainUsers.Add(pkg.Author!);
            db.Packages.Add(pkg);
        });
        await SeedAsync(db => db.PackageVersions.Add(NewVersion(pkg.Id, "1.0.0", yankedAt: DateTimeOffset.UtcNow)));

        var client = await AuthenticatedClientAsync();
        var response = await client.PostAsJsonAsync("/api/v1/registry/resolve", new
        {
            engineVersion = "1.0.0",
            dependencies = new Dictionary<string, string> { ["@acme/yanked-only-resolve"] = "^1.0.0" },
            pinned = (Dictionary<string, string>?)null,
        });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<ResolveResponse>();

        Assert.Equal("1.0.0", body!.Resolved["@acme/yanked-only-resolve"].Version);
        Assert.Contains(body.Warnings, w => w.Kind == "yanked");
    }

    [Fact]
    public async Task A_Diamond_Dependency_With_Incompatible_Ranges_Warns_Instead_Of_Failing()
    {
        // root depends on both A and B; A wants shared-dep ^1.0.0, B wants
        // it ^2.0.0. Forge doesn't support two versions of one package in
        // a project (docs/SPEC.md Section 13.4's own closing warning —
        // ECS component names are global strings), so the first
        // resolution wins and the second is flagged, not silently merged
        // and not hard-failed either.
        var (a, _, wsA) = NewPackage("@acme/diamond-a");
        var (b, _, wsB) = NewPackage("@acme/diamond-b");
        var (shared, _, wsShared) = NewPackage("@acme/diamond-shared");
        await SeedAsync(db =>
        {
            db.Workspaces.AddRange(wsA, wsB, wsShared);
            db.DomainUsers.AddRange(a.Author!, b.Author!, shared.Author!);
            db.Packages.AddRange(a, b, shared);
        });
        await SeedAsync(db => db.PackageVersions.AddRange(NewVersion(shared.Id, "1.0.0"), NewVersion(shared.Id, "2.0.0")));
        await SeedAsync(db => db.PackageVersions.Add(NewVersion(a.Id, "1.0.0",
            dependencies: new Dictionary<string, string> { ["@acme/diamond-shared"] = "^1.0.0" })));
        await SeedAsync(db => db.PackageVersions.Add(NewVersion(b.Id, "1.0.0",
            dependencies: new Dictionary<string, string> { ["@acme/diamond-shared"] = "^2.0.0" })));

        var client = await AuthenticatedClientAsync();
        var response = await client.PostAsJsonAsync("/api/v1/registry/resolve", new
        {
            engineVersion = "1.0.0",
            dependencies = new Dictionary<string, string>
            {
                ["@acme/diamond-a"] = "^1.0.0",
                ["@acme/diamond-b"] = "^1.0.0",
            },
            pinned = (Dictionary<string, string>?)null,
        });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<ResolveResponse>();

        Assert.Contains(body!.Warnings, w => w.Kind == "version-conflict" && w.Package == "@acme/diamond-shared");
        // Exactly one version of the shared dependency is resolved, not two.
        Assert.True(body.Resolved.ContainsKey("@acme/diamond-shared"));
    }

    [Fact]
    public async Task No_Satisfying_Version_Is_A_409()
    {
        var (pkg, _, ws) = NewPackage("@acme/no-satisfying-resolve");
        await SeedAsync(db =>
        {
            db.Workspaces.Add(ws);
            db.DomainUsers.Add(pkg.Author!);
            db.Packages.Add(pkg);
        });
        await SeedAsync(db => db.PackageVersions.Add(NewVersion(pkg.Id, "1.0.0")));

        var client = await AuthenticatedClientAsync();
        var response = await client.PostAsJsonAsync("/api/v1/registry/resolve", new
        {
            engineVersion = "1.0.0",
            dependencies = new Dictionary<string, string> { ["@acme/no-satisfying-resolve"] = "^2.0.0" },
            pinned = (Dictionary<string, string>?)null,
        });

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Unknown_Package_Is_A_404()
    {
        var client = await AuthenticatedClientAsync();
        var response = await client.PostAsJsonAsync("/api/v1/registry/resolve", new
        {
            engineVersion = "1.0.0",
            dependencies = new Dictionary<string, string> { ["@acme/does-not-exist-resolve"] = "^1.0.0" },
            pinned = (Dictionary<string, string>?)null,
        });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task An_Unscanned_Version_Is_Not_A_Candidate()
    {
        var (pkg, _, ws) = NewPackage("@acme/unscanned-resolve");
        await SeedAsync(db =>
        {
            db.Workspaces.Add(ws);
            db.DomainUsers.Add(pkg.Author!);
            db.Packages.Add(pkg);
        });
        await SeedAsync(db => db.PackageVersions.Add(NewVersion(pkg.Id, "1.0.0", scanStatus: PackageScanStatus.Pending)));

        var client = await AuthenticatedClientAsync();
        var response = await client.PostAsJsonAsync("/api/v1/registry/resolve", new
        {
            engineVersion = "1.0.0",
            dependencies = new Dictionary<string, string> { ["@acme/unscanned-resolve"] = "^1.0.0" },
            pinned = (Dictionary<string, string>?)null,
        });

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Engine_Mismatch_Is_A_Warning_Not_A_Failure()
    {
        var (pkg, _, ws) = NewPackage("@acme/engine-mismatch-resolve");
        await SeedAsync(db =>
        {
            db.Workspaces.Add(ws);
            db.DomainUsers.Add(pkg.Author!);
            db.Packages.Add(pkg);
        });
        await SeedAsync(db => db.PackageVersions.Add(NewVersion(pkg.Id, "1.0.0", engineRange: ">=5.0.0 <6.0.0")));

        var client = await AuthenticatedClientAsync();
        var response = await client.PostAsJsonAsync("/api/v1/registry/resolve", new
        {
            engineVersion = "1.0.0",
            dependencies = new Dictionary<string, string> { ["@acme/engine-mismatch-resolve"] = "^1.0.0" },
            pinned = (Dictionary<string, string>?)null,
        });
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<ResolveResponse>();

        Assert.Equal("1.0.0", body!.Resolved["@acme/engine-mismatch-resolve"].Version);
        Assert.Contains(body.Warnings, w => w.Kind == "engine-mismatch");
    }

    [Fact]
    public async Task A_Malformed_Range_Is_A_400()
    {
        var client = await AuthenticatedClientAsync();
        var response = await client.PostAsJsonAsync("/api/v1/registry/resolve", new
        {
            engineVersion = "1.0.0",
            dependencies = new Dictionary<string, string> { ["@acme/whatever"] = "not-a-range" },
            pinned = (Dictionary<string, string>?)null,
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_Malformed_Engine_Version_Is_A_400()
    {
        var client = await AuthenticatedClientAsync();
        var response = await client.PostAsJsonAsync("/api/v1/registry/resolve", new
        {
            engineVersion = "not-a-version",
            dependencies = new Dictionary<string, string>(),
            pinned = (Dictionary<string, string>?)null,
        });

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Unauthenticated_Request_Is_Rejected()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/v1/registry/resolve", new
        {
            engineVersion = "1.0.0",
            dependencies = new Dictionary<string, string>(),
            pinned = (Dictionary<string, string>?)null,
        });

        Assert.False(response.IsSuccessStatusCode);
    }
}
