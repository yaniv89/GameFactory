using System.Text;
using System.Text.Json;
using Forge.Domain.Entities;
using Forge.Functions.Scan;
using Forge.Functions.Scan.SmokeGate;
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

    private static (Package Package, Workspace Workspace) NewPackage(string name) => (
        new Package
        {
            Name = name, Kind = PackageKind.Module, DisplayName = name, Summary = "Fixture.", LicenseSpdx = "MIT",
            CreatedAt = DateTimeOffset.UtcNow,
            Author = new User { IdentitySubjectId = Guid.NewGuid().ToString(), Email = $"{Guid.NewGuid():N}@example.com", DisplayName = "Author", CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow },
        },
        new Workspace { Slug = $"ws-{Guid.NewGuid():N}", Name = "Author Workspace", CreatedAt = DateTimeOffset.UtcNow });

    private async Task<Guid> SeedPendingVersionWithBundleAsync(string packageName, string bundleSource, string version = "1.0.0")
    {
        var (pkg, ws) = NewPackage(packageName);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        db.Workspaces.Add(ws);
        db.DomainUsers.Add(pkg.Author!);
        db.Packages.Add(pkg);
        await db.SaveChangesAsync();

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
        return status is PackageScanStatus.Passed or PackageScanStatus.Blocked;
    }
}
