using System.Text;
using System.Text.Json;
using Forge.Domain.Entities;
using Forge.Functions.Scan;
using Forge.Functions.Scan.SmokeGate;
using Forge.Infrastructure.Identity;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Scan;

/// <summary>
/// The end-to-end proof for docs/SPEC.md Section 10.4 gate 4: seeds a
/// real <c>Pending</c> <see cref="PackageVersion"/>, uploads its real
/// bundle to the real Azurite-backed <see cref="IPackageBundleStorage"/>
/// (<see cref="ForgeWebApplicationFactory"/>'s own remarks), and drives
/// the whole claim → download → sandboxed smoke run → status-update cycle
/// through <see cref="ScanOrchestrator"/> exactly as the eventual Azure
/// Functions Worker trigger will. Every other test in this directory
/// covers one piece of this in isolation; this one is what proves the
/// pieces actually fit together.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class ScanOrchestratorTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public ScanOrchestratorTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    private static (Package Package, Workspace Workspace, Guid IdentitySubjectId) NewPackage(string name)
    {
        var identitySubjectId = Guid.NewGuid();
        var package = new Package
        {
            Name = name, Kind = PackageKind.Module, DisplayName = name, Summary = "Fixture.", LicenseSpdx = "MIT",
            CreatedAt = DateTimeOffset.UtcNow,
            Author = new User { IdentitySubjectId = identitySubjectId.ToString(), Email = $"{Guid.NewGuid():N}@example.com", DisplayName = "Author", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow },
        };
        var workspace = new Workspace { Slug = $"ws-{Guid.NewGuid():N}", Name = "Author Workspace", CreatedAt = DateTimeOffset.UtcNow };
        return (package, workspace, identitySubjectId);
    }

    /// <summary>
    /// Gate 4's own pass/blocked path (what most of this file proves) is
    /// deliberately independent of gate 5 (M7 Phase 3's reputation gate)
    /// — so every fixture here seeds an author who already qualifies for
    /// <see cref="Forge.Domain.Marketplace.AuthorTrustTier.Verified"/>:
    /// 2FA on the matching <see cref="ForgeIdentityUser"/> row, identity
    /// verified, and 90+ days of tenure via an already-<c>Passed</c>
    /// earlier version (not a backdated <see cref="PackageVersion.PublishedAt"/>
    /// on the version actually under test, which would misrepresent when
    /// it was really submitted). <c>An_Unverified_Authors_Benign_Bundle_Is_Flagged_For_Review_Not_Auto_Passed</c>
    /// below is the one test that deliberately skips this qualification,
    /// to prove gate 5's own routing.
    /// </summary>
    private async Task<Guid> SeedPendingVersionWithBundleAsync(string packageName, string bundleSource, string version = "1.0.0", bool authorQualifiesAsVerified = true)
    {
        var (pkg, ws, identitySubjectId) = NewPackage(packageName);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        db.Workspaces.Add(ws);
        if (authorQualifiesAsVerified) pkg.Author!.IdentityVerifiedAt = DateTimeOffset.UtcNow.AddDays(-120);
        db.DomainUsers.Add(pkg.Author!);
        db.Packages.Add(pkg);
        db.Users.Add(new ForgeIdentityUser
        {
            Id = identitySubjectId,
            UserName = pkg.Author!.Email,
            NormalizedUserName = pkg.Author.Email.ToUpperInvariant(),
            Email = pkg.Author.Email,
            NormalizedEmail = pkg.Author.Email.ToUpperInvariant(),
            TwoFactorEnabled = authorQualifiesAsVerified,
        });
        await db.SaveChangesAsync();

        if (authorQualifiesAsVerified)
        {
            db.PackageVersions.Add(new PackageVersion
            {
                PackageId = pkg.Id,
                Version = "0.1.0",
                EngineRange = ">=1.0.0 <2.0.0",
                Manifest = JsonSerializer.SerializeToElement(new { }),
                BundleUrl = "https://example.invalid/prior-qualifying-version.js",
                BundleSha256 = System.Security.Cryptography.SHA256.HashData("prior-qualifying-version"u8.ToArray()),
                SizeBytes = 1,
                ScanStatus = PackageScanStatus.Passed,
                PublishedAt = DateTimeOffset.UtcNow.AddDays(-120),
            });
            await db.SaveChangesAsync();
        }

        var bundleStorage = scope.ServiceProvider.GetRequiredService<IPackageBundleStorage>();
        var bundleUrl = await bundleStorage.UploadAsync(packageName, version, Encoding.UTF8.GetBytes(bundleSource), "application/javascript", CancellationToken.None);

        var packageVersion = new PackageVersion
        {
            PackageId = pkg.Id,
            Version = version,
            EngineRange = ">=1.0.0 <2.0.0",
            Manifest = JsonSerializer.SerializeToElement(new { }),
            BundleUrl = bundleUrl,
            BundleSha256 = System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(bundleSource)),
            SizeBytes = Encoding.UTF8.GetByteCount(bundleSource),
            ScanStatus = PackageScanStatus.Pending,
            PublishedAt = DateTimeOffset.UtcNow,
        };
        db.PackageVersions.Add(packageVersion);
        await db.SaveChangesAsync();
        return packageVersion.Id;
    }

    private ScanOrchestrator BuildOrchestrator(ForgeDbContext db, IPackageBundleStorage bundleStorage) =>
        new(new PendingVersionScanner(db), bundleStorage, new SmokeRunGate(new SmokeGateOptions
        {
            CliBundlePath = RepoPaths.Resolve("packages/runtime-host/dist/smoke/cli.bundle.mjs"),
        }));

    [Fact]
    public async Task A_Benign_Published_Bundle_Ends_Up_Passed_With_A_Stored_Report()
    {
        var name = "@acme/scan-orchestrator-pass";
        var versionId = await SeedPendingVersionWithBundleAsync(
            name, "(function () { __forge_registerModule({ setup: function () {} }); })();");

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var bundleStorage = scope.ServiceProvider.GetRequiredService<IPackageBundleStorage>();
        var orchestrator = BuildOrchestrator(db, bundleStorage);

        bool scanned;
        do
        {
            scanned = await orchestrator.ScanNextAsync(CancellationToken.None);
        } while (scanned && !await IsResolvedAsync(versionId));

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var version = await verifyDb.PackageVersions.SingleAsync(v => v.Id == versionId);

        Assert.Equal(PackageScanStatus.Passed, version.ScanStatus);
        Assert.NotNull(version.ScanReport);
        Assert.Equal("passed", version.ScanReport!.Value.GetProperty("verdict").GetString());
    }

    [Fact]
    public async Task A_Bundle_Whose_Setup_Crashes_The_Sandbox_Ends_Up_Blocked_With_A_Stored_Report()
    {
        var name = "@acme/scan-orchestrator-blocked";
        var versionId = await SeedPendingVersionWithBundleAsync(
            name,
            "(function () { function setup() { function r(n) { return r(n + 1); } r(0); } __forge_registerModule({ setup: setup }); })();");

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var bundleStorage = scope.ServiceProvider.GetRequiredService<IPackageBundleStorage>();
        var orchestrator = BuildOrchestrator(db, bundleStorage);

        bool scanned;
        do
        {
            scanned = await orchestrator.ScanNextAsync(CancellationToken.None);
        } while (scanned && !await IsResolvedAsync(versionId));

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var version = await verifyDb.PackageVersions.SingleAsync(v => v.Id == versionId);

        Assert.Equal(PackageScanStatus.Blocked, version.ScanStatus);
        Assert.NotNull(version.ScanReport);
        Assert.Equal("blocked", version.ScanReport!.Value.GetProperty("verdict").GetString());
        Assert.True(version.ScanReport.Value.GetProperty("crashed").GetBoolean());
    }

    [Fact]
    public async Task An_Unverified_Authors_Benign_Bundle_Is_Flagged_For_Review_Not_Auto_Passed()
    {
        var name = "@acme/scan-orchestrator-gate5-unverified";
        var versionId = await SeedPendingVersionWithBundleAsync(
            name, "(function () { __forge_registerModule({ setup: function () {} }); })();", authorQualifiesAsVerified: false);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var bundleStorage = scope.ServiceProvider.GetRequiredService<IPackageBundleStorage>();
        var orchestrator = BuildOrchestrator(db, bundleStorage);

        bool scanned;
        do
        {
            scanned = await orchestrator.ScanNextAsync(CancellationToken.None);
        } while (scanned && !await IsResolvedAsync(versionId));

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var version = await verifyDb.PackageVersions.SingleAsync(v => v.Id == versionId);

        // The smoke run itself passed (it's the same benign bundle as
        // the qualified-author test above) — gate 5 is what kept this
        // out of Passed, proven by the report itself still showing a
        // real "passed" verdict even though the version's own status is
        // Flagged, not Passed.
        Assert.Equal(PackageScanStatus.Flagged, version.ScanStatus);
        Assert.NotNull(version.ScanReport);
        Assert.Equal("passed", version.ScanReport!.Value.GetProperty("verdict").GetString());
    }

    [Fact]
    public async Task ScanNextAsync_Returns_False_Once_Nothing_Is_Left_To_Claim()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var bundleStorage = scope.ServiceProvider.GetRequiredService<IPackageBundleStorage>();
        var orchestrator = BuildOrchestrator(db, bundleStorage);

        // Drain whatever this fixture's Postgres container currently has
        // pending (other tests in this class share it), then confirm the
        // terminal case.
        while (await orchestrator.ScanNextAsync(CancellationToken.None)) { }

        Assert.False(await orchestrator.ScanNextAsync(CancellationToken.None));
    }

    private async Task<bool> IsResolvedAsync(Guid versionId)
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var status = await db.PackageVersions.Where(v => v.Id == versionId).Select(v => v.ScanStatus).SingleAsync();
        return status is PackageScanStatus.Passed or PackageScanStatus.Blocked or PackageScanStatus.Flagged;
    }
}
