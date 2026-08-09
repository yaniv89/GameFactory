using System.Data;
using System.Text.Json;
using Forge.Domain.Entities;
using Forge.Domain.Marketplace;
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
        // Raw ADO.NET via Database.GetDbConnection(), not
        // Database.SqlQueryRaw<T> — confirmed by a real CI failure, not
        // assumed: EF Core 8's SqlQueryRaw<T> threw
        // IndexOutOfRangeException deep in its own query-compilation
        // pipeline (NavigationExpandingExpressionVisitor) for this
        // composite, multi-column, non-entity result shape. This escape
        // hatch bypasses that pipeline entirely — it's EF Core's own
        // documented way to run a command through the context's managed
        // connection when the LINQ/SqlQuery surface doesn't fit, not a
        // step outside EF Core's supported usage.
        var connection = db.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open)
        {
            await connection.OpenAsync(ct);
        }

        Guid id, packageId;
        string version, engineRange, manifestJson, bundleUrl;

        // Sync `using`, not `await using`: DbCommand implements
        // IDisposable but not IAsyncDisposable (unlike DbConnection and
        // DbDataReader, which do) — it holds no async-disposable resource
        // of its own.
        using (var command = connection.CreateCommand())
        {
            command.CommandText =
                """
                UPDATE package_versions
                SET scan_status = @scanning
                WHERE id = (
                    SELECT id FROM package_versions
                    WHERE scan_status = @pending
                    ORDER BY published_at ASC
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                RETURNING id, package_id, version, engine_range, manifest::text, bundle_url
                """;
            AddParameter(command, "pending", PackageScanStatus.Pending);
            AddParameter(command, "scanning", PackageScanStatus.Scanning);

            await using var reader = await command.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return null;

            id = reader.GetGuid(0);
            packageId = reader.GetGuid(1);
            version = reader.GetString(2);
            engineRange = reader.GetString(3);
            manifestJson = reader.GetString(4);
            bundleUrl = reader.GetString(5);
        }

        // A second round trip, not folded into the claim's own RETURNING:
        // package name lives on `packages`, not `package_versions`, and
        // joining that into the raw claim SQL above would mean either a
        // second FOR UPDATE target or trusting an unlocked read inside
        // the same statement — an ordinary LINQ read afterward is simpler
        // and carries no correctness risk (the package row itself is
        // immutable identity, never renamed after creation).
        var packageName = await db.Packages
            .Where(p => p.Id == packageId)
            .Select(p => p.Name)
            .SingleAsync(ct);

        return new ScannedVersion(
            id, packageId, packageName, version, engineRange,
            JsonDocument.Parse(manifestJson).RootElement, bundleUrl);
    }

    private static void AddParameter(IDbCommand command, string name, string value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }

    public Task MarkPassedAsync(Guid versionId, SmokeGate.SmokeRunReport report, CancellationToken ct) =>
        SetFinalStatusAsync(versionId, PackageScanStatus.Passed, report, ct);

    public Task MarkBlockedAsync(Guid versionId, SmokeGate.SmokeRunReport report, CancellationToken ct) =>
        SetFinalStatusAsync(versionId, PackageScanStatus.Blocked, report, ct);

    /// <summary>Gate 5 (M7 Phase 3): the version cleared gate 4 but its author's trust tier requires a human review before this can become <see cref="PackageScanStatus.Passed"/> — see that constant's own doc comment.</summary>
    public Task MarkFlaggedForReviewAsync(Guid versionId, SmokeGate.SmokeRunReport report, CancellationToken ct) =>
        SetFinalStatusAsync(versionId, PackageScanStatus.Flagged, report, ct);

    /// <summary>
    /// Gate 5's inputs (docs/SPEC.md Section 10.4/16.3) for the author who
    /// owns <paramref name="packageId"/>. Two-factor status is read from
    /// <c>ForgeIdentityUser.TwoFactorEnabled</c> — the domain
    /// <see cref="User"/> row never duplicates it — via
    /// <see cref="User.IdentitySubjectId"/> parsed back to the
    /// <see cref="Guid"/> Identity keys its own store by (the same
    /// string-claim round trip <c>CurrentUserMiddleware</c> does the
    /// other direction). Identity verification/security audit/SLA
    /// acceptance and refund rate are stated gaps — see
    /// <see cref="AuthorTrustSignals"/>'s own doc comment on each.
    /// </summary>
    public async Task<AuthorTrustSignals> GetAuthorTrustSignalsAsync(Guid packageId, CancellationToken ct)
    {
        // Package.Author is a real, explicitly-configured navigation
        // (PackageConfiguration.cs: HasOne(p => p.Author).HasForeignKey(p
        // => p.AuthorUserId)) — safe to project directly rather than a
        // separate round trip against the AuthorUserId scalar.
        var author = await db.Packages
            .Where(p => p.Id == packageId)
            .Select(p => new { p.AuthorUserId, p.Author!.IdentitySubjectId, p.Author.IdentityVerifiedAt, p.Author.SecurityAuditPassedAt, p.Author.SlaAcceptedAt })
            .SingleAsync(ct);

        var identitySubjectId = Guid.Parse(author.IdentitySubjectId);
        var twoFactorEnabled = await db.Users
            .Where(u => u.Id == identitySubjectId)
            .Select(u => u.TwoFactorEnabled)
            .SingleOrDefaultAsync(ct);

        // PackageVersion.Package (via PackageId) is the same kind of
        // real, explicit navigation (PackageConfiguration.cs's own
        // HasMany(p => p.Versions).WithOne(v => v.Package)).
        var firstPublishedAt = await db.PackageVersions
            .Where(v => v.Package!.AuthorUserId == author.AuthorUserId)
            .OrderBy(v => v.PublishedAt)
            .Select(v => (DateTimeOffset?)v.PublishedAt)
            .FirstOrDefaultAsync(ct);

        return new AuthorTrustSignals(
            TwoFactorEnabled: twoFactorEnabled,
            IdentityVerified: author.IdentityVerifiedAt is not null,
            FirstPublishedAt: firstPublishedAt,
            RefundRate: 0.0, // M7 Phase 4/5: no real purchase/refund data exists yet.
            SecurityAuditPassed: author.SecurityAuditPassedAt is not null,
            SlaAccepted: author.SlaAcceptedAt is not null);
    }

    private async Task SetFinalStatusAsync(Guid versionId, string status, SmokeGate.SmokeRunReport report, CancellationToken ct)
    {
        var reportJson = JsonSerializer.Serialize(report, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        // Persists the real measured mean tick cost alongside the
        // pass/fail verdict on every finalization path, not only Passed —
        // PackageRankingCalculator (M7 Phase 6) only ever reads this off
        // whatever the latest resolvable version is, and a Blocked/
        // Flagged run still produced a real measurement worth keeping.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"""
            UPDATE package_versions
            SET scan_status = {status}, scan_report = {reportJson}::jsonb, measured_average_tick_ms = {report.Budget.AverageTickMs}
            WHERE id = {versionId}
            """, ct);
    }
}
