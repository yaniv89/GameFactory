using System.Text.Json;
using Forge.Domain.Entities;
using Forge.Functions.Scan;
using Forge.Functions.Scan.SmokeGate;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Forge.Tests.Features.Scan;

/// <summary>
/// docs/SPEC.md Section 10.4 gate 4's claim/complete lifecycle, against a
/// real Postgres (<see cref="ForgeWebApplicationFactory"/>) — the
/// concurrent-claim test specifically exists to prove the <c>FOR UPDATE
/// SKIP LOCKED</c> claim SQL actually is safe under N horizontally-scaled
/// scanner instances (CLAUDE.md Section 1.5 guardrail 20), not just that
/// it reads as if it should be.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class PendingVersionScannerTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public PendingVersionScannerTests(ForgeWebApplicationFactory factory)
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

    private static PackageVersion PendingVersion(Guid packageId, string version = "1.0.0") => new()
    {
        PackageId = packageId,
        Version = version,
        EngineRange = ">=1.0.0 <2.0.0",
        Manifest = JsonSerializer.SerializeToElement(new { networkAllowlist = new[] { "example.com" } }),
        BundleUrl = $"https://cdn.forge.dev/p/{packageId}/{version}/bundle.js",
        BundleSha256 = System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes($"{packageId}@{version}")),
        SizeBytes = 1024,
        ScanStatus = PackageScanStatus.Pending,
        PublishedAt = DateTimeOffset.UtcNow,
    };

    private async Task SeedPendingVersionAsync(string packageName)
    {
        var (pkg, ws) = NewPackage(packageName);
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        db.Workspaces.Add(ws);
        db.DomainUsers.Add(pkg.Author!);
        db.Packages.Add(pkg);
        await db.SaveChangesAsync();
        db.PackageVersions.Add(PendingVersion(pkg.Id));
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Claiming_With_Nothing_Pending_Returns_Null()
    {
        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var scanner = new PendingVersionScanner(db);

        // Not a clean-table assumption (other tests in this fixture seed
        // rows too) — claim in a loop until empty, proving the terminal
        // null rather than relying on execution order.
        while (await scanner.ClaimNextAsync(CancellationToken.None) is not null) { }
        var result = await scanner.ClaimNextAsync(CancellationToken.None);

        Assert.Null(result);
    }

    [Fact]
    public async Task Claiming_A_Pending_Version_Flips_It_To_Scanning_And_Resolves_The_Package_Name()
    {
        var name = "@acme/scan-claim-basic";
        await SeedPendingVersionAsync(name);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var scanner = new PendingVersionScanner(db);

        var claimed = await scanner.ClaimNextAsync(CancellationToken.None);
        // Another seeded-but-unrelated pending row from a different test
        // in this fixture could be claimed first — only assert on this
        // one once found, draining if needed.
        while (claimed is not null && claimed.PackageName != name)
        {
            claimed = await scanner.ClaimNextAsync(CancellationToken.None);
        }

        Assert.NotNull(claimed);
        Assert.Equal(name, claimed!.PackageName);
        Assert.Equal("1.0.0", claimed.ModuleVersion);
        Assert.Equal(">=1.0.0 <2.0.0", claimed.EngineRange);

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var status = await verifyDb.PackageVersions.Where(v => v.Id == claimed.VersionId).Select(v => v.ScanStatus).SingleAsync();
        Assert.Equal(PackageScanStatus.Scanning, status);
    }

    [Fact]
    public async Task Two_Concurrent_Claims_Against_Two_Pending_Rows_Never_Return_The_Same_Row()
    {
        var nameA = "@acme/scan-claim-concurrent-a";
        var nameB = "@acme/scan-claim-concurrent-b";
        await SeedPendingVersionAsync(nameA);
        await SeedPendingVersionAsync(nameB);

        using var scopeA = _factory.Services.CreateScope();
        using var scopeB = _factory.Services.CreateScope();
        var scannerA = new PendingVersionScanner(scopeA.ServiceProvider.GetRequiredService<ForgeDbContext>());
        var scannerB = new PendingVersionScanner(scopeB.ServiceProvider.GetRequiredService<ForgeDbContext>());

        var results = await Task.WhenAll(
            scannerA.ClaimNextAsync(CancellationToken.None),
            scannerB.ClaimNextAsync(CancellationToken.None));

        var claimedIds = results.Where(r => r is not null).Select(r => r!.VersionId).ToList();
        Assert.Equal(claimedIds.Count, claimedIds.Distinct().Count());
    }

    [Fact]
    public async Task MarkPassedAsync_Sets_Passed_Status_And_Stores_The_Report()
    {
        var name = "@acme/scan-mark-passed";
        await SeedPendingVersionAsync(name);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var scanner = new PendingVersionScanner(db);
        var claimed = await FindAndClaimAsync(scanner, name);

        var report = new SmokeRunReport
        {
            Verdict = "passed", TicksRequested = 600, TicksCompleted = 600, Crashed = false,
            Budget = new SmokeRunBudget { MaxTickMs = 1.2, TotalMs = 300, AverageTickMs = 0.5 },
        };
        await scanner.MarkPassedAsync(claimed.VersionId, report, CancellationToken.None);

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var version = await verifyDb.PackageVersions.SingleAsync(v => v.Id == claimed.VersionId);
        Assert.Equal(PackageScanStatus.Passed, version.ScanStatus);
        Assert.NotNull(version.ScanReport);
        Assert.Equal("passed", version.ScanReport!.Value.GetProperty("verdict").GetString());
    }

    [Fact]
    public async Task MarkBlockedAsync_Sets_Blocked_Status_And_Stores_The_Report()
    {
        var name = "@acme/scan-mark-blocked";
        await SeedPendingVersionAsync(name);

        using var scope = _factory.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var scanner = new PendingVersionScanner(db);
        var claimed = await FindAndClaimAsync(scanner, name);

        var report = new SmokeRunReport
        {
            Verdict = "blocked", TicksRequested = 600, TicksCompleted = 0, Crashed = true,
            Error = new SmokeRunError { Phase = "setup", Name = "RangeError", Message = "sandbox runtime failed and was torn down" },
            Budget = new SmokeRunBudget { MaxTickMs = 0, TotalMs = 0, AverageTickMs = 0 },
        };
        await scanner.MarkBlockedAsync(claimed.VersionId, report, CancellationToken.None);

        using var verifyScope = _factory.Services.CreateScope();
        var verifyDb = verifyScope.ServiceProvider.GetRequiredService<ForgeDbContext>();
        var version = await verifyDb.PackageVersions.SingleAsync(v => v.Id == claimed.VersionId);
        Assert.Equal(PackageScanStatus.Blocked, version.ScanStatus);
        Assert.NotNull(version.ScanReport);
        Assert.Equal("blocked", version.ScanReport!.Value.GetProperty("verdict").GetString());
    }

    private static async Task<ScannedVersion> FindAndClaimAsync(PendingVersionScanner scanner, string packageName)
    {
        for (var attempt = 0; attempt < 50; attempt++)
        {
            var claimed = await scanner.ClaimNextAsync(CancellationToken.None);
            if (claimed is null) throw new InvalidOperationException($"Ran out of pending versions before finding '{packageName}'.");
            if (claimed.PackageName == packageName) return claimed;
        }
        throw new InvalidOperationException($"Did not find '{packageName}' among the first 50 claimed versions.");
    }
}
