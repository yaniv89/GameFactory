using System.Text;
using System.Text.Json;
using Forge.Domain.Marketplace;
using Forge.Functions.Scan.SmokeGate;
using Forge.Infrastructure.Storage;

namespace Forge.Functions.Scan;

/// <summary>
/// Wires <see cref="PendingVersionScanner"/> (claim/complete against
/// <c>package_versions</c>), <see cref="IPackageBundleStorage"/> (fetch
/// the real bundle text) and <see cref="SmokeRunGate"/> (run it in the
/// real sandbox) into gate 4's actual per-version workflow, then gate 5
/// (M7 Phase 3, docs/SPEC.md Section 10.4): a version that clears gate 4
/// only reaches <see cref="Forge.Domain.Entities.PackageScanStatus.Passed"/>
/// automatically if its author's <see cref="AuthorTrustTier"/> is
/// <see cref="AuthorTrustTier.Verified"/> or <see cref="AuthorTrustTier.Partner"/>
/// — an <see cref="AuthorTrustTier.Unverified"/> author's version is
/// routed to the manual review queue instead
/// (<see cref="Forge.Domain.Entities.PackageScanStatus.Flagged"/>), matching
/// the SPEC's own "new authors: manual review queue, established
/// authors: automated pass" description. The Azure Functions Worker
/// trigger that calls <see cref="ScanNextAsync"/> on a schedule doesn't
/// exist yet — see Forge.Functions.Scan.csproj's own comment for why
/// that's deliberately a separate, later change — but this class is the
/// whole real gate, independently callable and tested without it.
/// </summary>
public sealed class ScanOrchestrator(
    PendingVersionScanner scanner,
    IPackageBundleStorage bundleStorage,
    SmokeRunGate smokeGate)
{
    // docs/SPEC.md doesn't define a single platform-wide "current engine
    // version" registry anywhere this class can read from yet — the
    // module-api version M3 built has no such source of truth either.
    // A module's own SetupContext.engineVersion is descriptive only (it
    // never gates the smoke run itself), so a stable placeholder is
    // honest here rather than guessing a real value that doesn't exist
    // yet. Tracked as a gap, not silently assumed correct.
    private const string PlaceholderEngineVersion = "0.0.0-smoke-gate";

    /// <summary>Claims and scans one pending version, if any is available. Returns false when there was nothing to claim — the caller (a timer trigger) treats that as "nothing to do this tick," not an error.</summary>
    public async Task<bool> ScanNextAsync(CancellationToken ct)
    {
        var claimed = await scanner.ClaimNextAsync(ct);
        if (claimed is null) return false;

        var bundleBytes = await bundleStorage.DownloadAsync(claimed.PackageName, claimed.ModuleVersion, ct);
        var bundleSource = Encoding.UTF8.GetString(bundleBytes);

        var request = new SmokeRunRequest
        {
            ModuleName = claimed.PackageName,
            Version = claimed.ModuleVersion,
            EngineVersion = PlaceholderEngineVersion,
            BundleSource = bundleSource,
            NetworkAllowedOrigins = ExtractNetworkAllowlist(claimed.Manifest),
        };

        var report = await smokeGate.RunAsync(request, ct);

        if (report.Verdict == "passed")
        {
            var signals = await scanner.GetAuthorTrustSignalsAsync(claimed.PackageId, ct);
            var tier = AuthorTrustTierCalculator.Calculate(signals, DateTimeOffset.UtcNow);

            if (tier == AuthorTrustTier.Unverified)
            {
                await scanner.MarkFlaggedForReviewAsync(claimed.VersionId, report, ct);
            }
            else
            {
                await scanner.MarkPassedAsync(claimed.VersionId, report, ct);
            }
        }
        else
        {
            await scanner.MarkBlockedAsync(claimed.VersionId, report, ct);
        }

        return true;
    }

    /// <summary>
    /// Same extraction PublishVersionEndpoint.cs's gate 2 already does —
    /// duplicated rather than shared, since Forge.Api and
    /// Forge.Functions.Scan aren't (and per CLAUDE.md Section 3.2's
    /// "public-API-only" discipline for first-party modules, shouldn't
    /// casually become) cross-referenced projects. ~10 lines of JSON
    /// parsing isn't worth a shared package for two callers.
    /// </summary>
    private static string[]? ExtractNetworkAllowlist(JsonElement manifest)
    {
        if (manifest.ValueKind != JsonValueKind.Object
            || !manifest.TryGetProperty("networkAllowlist", out var allowlist)
            || allowlist.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        var domains = new List<string>();
        foreach (var entry in allowlist.EnumerateArray())
        {
            if (entry.ValueKind == JsonValueKind.String && entry.GetString() is { Length: > 0 } domain)
            {
                domains.Add(domain);
            }
        }
        return domains.Count > 0 ? [.. domains] : null;
    }
}
