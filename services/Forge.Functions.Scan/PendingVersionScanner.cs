using System.Text.Json;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Functions.Scan;

/// <summary>One <see cref="PackageVersion"/> claimed for gate 4, with its identity resolved (package name isn't on the version row itself) and its manifest already parsed.</summary>
public sealed record ScannedVersion(
    Guid VersionId,
    Guid PackageId,
    string PackageName,
    string ModuleVersion,
    string EngineRange,
    JsonElement Manifest,
    string BundleUrl);

/// <summary>
/// docs/SPEC.md Section 10.4 gate 4's claim/complete lifecycle against
/// <c>package_versions</c>. Every method here is a short, single
/// statement — no long-held transaction spans the actual smoke run
/// itself (which can take up to <see cref="SmokeGate.SmokeGateOptions.TimeoutSeconds"/>),
/// so a slow scan never ties up a pooled connection for that whole
/// duration (CLAUDE.md Section 1.5 guardrail 21).
///
/// <see cref="ClaimNextAsync"/>'s <c>Scanning</c> transition is what
/// keeps N horizontally-scaled instances of this scanner from claiming
/// the same row (guardrail 20) — <c>FOR UPDATE SKIP LOCKED</c> means a
/// concurrent claim never blocks on this one, it just skips to the next
/// candidate. A known, stated gap: a claimed row whose scanner instance
/// crashes or is killed before ever calling <see cref="MarkPassedAsync"/>/
/// <see cref="MarkBlockedAsync"/> stays <c>Scanning</c> forever — no
/// reclaim-after-timeout sweep exists yet. Real, but out of this phase's
/// scope; tracked as follow-up work, not silently missing.
/// </summary>
public sealed class PendingVersionScanner(ForgeDbContext db)
{
    public async Task<ScannedVersion?> ClaimNextAsync(CancellationToken ct)
    {
        var rows = await db.Database.SqlQueryRaw<ClaimedVersionRow>(
            """
            UPDATE package_versions
            SET scan_status = {1}
            WHERE id = (
                SELECT id FROM package_versions
                WHERE scan_status = {0}
                ORDER BY published_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING
                id AS "Id",
                package_id AS "PackageId",
                version AS "Version",
                engine_range AS "EngineRange",
                manifest::text AS "ManifestJson",
                bundle_url AS "BundleUrl"
            """,
            PackageScanStatus.Pending, PackageScanStatus.Scanning)
            .ToListAsync(ct);

        var row = rows.SingleOrDefault();
        if (row is null) return null;

        // A second round trip, not folded into the claim's own RETURNING:
        // package name lives on `packages`, not `package_versions`, and
        // joining that into the raw claim SQL above would mean either a
        // second FOR UPDATE target or trusting an unlocked read inside
        // the same statement — an ordinary LINQ read afterward is simpler
        // and carries no correctness risk (the package row itself is
        // immutable identity, never renamed after creation).
        var packageName = await db.Packages
            .Where(p => p.Id == row.PackageId)
            .Select(p => p.Name)
            .SingleAsync(ct);

        return new ScannedVersion(
            row.Id, row.PackageId, packageName, row.Version, row.EngineRange,
            JsonDocument.Parse(row.ManifestJson).RootElement, row.BundleUrl);
    }

    public Task MarkPassedAsync(Guid versionId, SmokeGate.SmokeRunReport report, CancellationToken ct) =>
        SetFinalStatusAsync(versionId, PackageScanStatus.Passed, report, ct);

    public Task MarkBlockedAsync(Guid versionId, SmokeGate.SmokeRunReport report, CancellationToken ct) =>
        SetFinalStatusAsync(versionId, PackageScanStatus.Blocked, report, ct);

    private async Task SetFinalStatusAsync(Guid versionId, string status, SmokeGate.SmokeRunReport report, CancellationToken ct)
    {
        var reportJson = JsonSerializer.Serialize(report, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            UPDATE package_versions
            SET scan_status = {status}, scan_report = {reportJson}::jsonb
            WHERE id = {versionId}
            """, ct);
    }
}

file sealed class ClaimedVersionRow
{
    public Guid Id { get; set; }
    public Guid PackageId { get; set; }
    public string Version { get; set; } = "";
    public string EngineRange { get; set; } = "";
    public string ManifestJson { get; set; } = "";
    public string BundleUrl { get; set; } = "";
}
