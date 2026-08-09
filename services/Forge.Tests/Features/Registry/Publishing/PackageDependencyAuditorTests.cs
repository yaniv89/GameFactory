using System.Text.Json;
using Forge.Api.Features.Registry.Publishing;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Registry.Publishing;

/// <summary>
/// Targets <see cref="PackageDependencyAuditor"/> directly against seeded
/// <see cref="PackageScanStatus.Passed"/> fixture rows — the real publish
/// endpoint only ever inserts <see cref="PackageScanStatus.Pending"/>
/// rows (M6 Phase 2 doesn't have gate 4 yet), so this is the only way to
/// exercise the cycle-detection path against dependencies the audit
/// would actually consider a valid resolution target.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class PackageDependencyAuditorTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public PackageDependencyAuditorTests(ForgeWebApplicationFactory factory)
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

    private static (Package Package, Workspace Workspace) NewPackage(string name) => (
        new Package
        {
            Name = name, Kind = PackageKind.Module, DisplayName = name, Summary = "Fixture.", LicenseSpdx = "MIT",
            CreatedAt = DateTimeOffset.UtcNow,
            Author = new User { IdentitySubjectId = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid():N}@example.com", DisplayName = "Author", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow },
        },
        new Workspace { Slug = $"ws-{Guid.NewGuid():N}", Name = "Author Workspace", CreatedAt = DateTimeOffset.UtcNow });

    private static PackageVersion PassedVersion(Guid packageId, string version = "1.0.0") => new()
    {
        PackageId = packageId,
        Version = version,
        EngineRange = ">=1.0.0 <2.0.0",
        Manifest = JsonSerializer.SerializeToElement(new { }),
        BundleUrl = $"https://cdn.forge.dev/p/{packageId}/{version}/bundle.js",
        BundleSha256 = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes($"{packageId}@{version}")),
        SizeBytes = 1024,
        ScanStatus = PackageScanStatus.Passed,
        PublishedAt = DateTimeOffset.UtcNow,
    };

    [Fact]
    public async Task A_Dependency_On_An_Existing_Passed_Version_Passes_The_Audit()
    {
        var (pkg, ws) = NewPackage("@acme/audit-simple-dep");
        await SeedAsync(db => { db.Workspaces.Add(ws); db.DomainUsers.Add(pkg.Author!); db.Packages.Add(pkg); });
        await SeedAsync(db => db.PackageVersions.Add(PassedVersion(pkg.Id)));

        using var scope = _factory.Services.CreateScope();
        var db2 = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var auditor = new PackageDependencyAuditor(db2);

        var result = await auditor.AuditAsync("@acme/audit-publishing-package", new Dictionary<string, string> { ["@acme/audit-simple-dep"] = "^1.0.0" }, CancellationToken.None);

        Assert.True(result.Passed, string.Join("; ", result.Errors));
    }

    [Fact]
    public async Task A_Transitive_Self_Reference_Fails_The_Audit_As_A_Cycle()
    {
        var (a, wsA) = NewPackage("@acme/audit-cycle-a");
        var (b, wsB) = NewPackage("@acme/audit-cycle-b");
        await SeedAsync(db =>
        {
            db.Workspaces.AddRange(wsA, wsB);
            db.DomainUsers.AddRange(a.Author!, b.Author!);
            db.Packages.AddRange(a, b);
        });
        // B already depends on A.
        var bVersion = PassedVersion(b.Id);
        bVersion.Dependencies.Add(new PackageDependency { DependsOnName = "@acme/audit-cycle-a", VersionRange = "^1.0.0" });
        await SeedAsync(db => db.PackageVersions.Add(bVersion));
        await SeedAsync(db => db.PackageVersions.Add(PassedVersion(a.Id)));

        using var scope = _factory.Services.CreateScope();
        var db2 = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var auditor = new PackageDependencyAuditor(db2);

        // Publishing A now declaring a dependency on B would close the
        // cycle: A -> B -> A.
        var result = await auditor.AuditAsync("@acme/audit-cycle-a", new Dictionary<string, string> { ["@acme/audit-cycle-b"] = "^1.0.0" }, CancellationToken.None);

        Assert.False(result.Passed);
        Assert.Contains(result.Errors, e => e.Contains("Cyclic"));
    }

    [Fact]
    public async Task An_Invalid_Range_Fails_The_Audit()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var auditor = new PackageDependencyAuditor(db);

        var result = await auditor.AuditAsync("@acme/audit-invalid-range", new Dictionary<string, string> { ["@acme/whatever"] = "not-a-range" }, CancellationToken.None);

        Assert.False(result.Passed);
    }
}
