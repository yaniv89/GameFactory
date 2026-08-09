using System.Text.Json;

namespace Forge.Domain.Entities;

/// <summary>
/// One immutable, published version of a <see cref="Package"/>
/// (docs/SPEC.md Section 6.2). Published versions are never mutated —
/// only <see cref="YankedAt"/> can change after publish, hiding the
/// version from new resolution while projects already pinned to it keep
/// resolving it (the npm model, docs/SPEC.md's own words for why this is
/// correct).
/// </summary>
public sealed class PackageVersion
{
    public Guid Id { get; set; }

    public Guid PackageId { get; set; }

    /// <summary>Strict semver — see <see cref="Versioning.SemVer"/>.</summary>
    public required string Version { get; set; }

    /// <summary>The engine version range this version targets, e.g. <c>&gt;=2.1.0 &lt;3.0.0</c>.</summary>
    public required string EngineRange { get; set; }

    /// <summary>The Module or Art Pack manifest (docs/SPEC.md Section 9.2 / 11.2), stored as jsonb.</summary>
    public required JsonElement Manifest { get; set; }

    /// <summary>Immutable CDN path to the published bundle.</summary>
    public required string BundleUrl { get; set; }

    public required byte[] BundleSha256 { get; set; }

    public int SizeBytes { get; set; }

    public string ScanStatus { get; set; } = PackageScanStatus.Pending;

    public JsonElement? ScanReport { get; set; }

    public DateTimeOffset PublishedAt { get; set; }

    public DateTimeOffset? YankedAt { get; set; }

    public string? YankReason { get; set; }

    /// <summary>
    /// Gate 4's real, measured mean per-tick cost from the sandboxed
    /// smoke run (<c>SmokeRunReport.Budget.AverageTickMs</c>), persisted
    /// here the moment that gate passes — docs/SPEC.md Section 16.2 calls
    /// publishing measured frame cost "novel and valuable... ship it from
    /// day one," and this is where it's kept once measured rather than
    /// discarded after the gate's own pass/fail decision. <c>null</c> for
    /// any version that hasn't (yet) cleared gate 4 with a real
    /// measurement — <see cref="Marketplace.PackageRankingCalculator"/>
    /// treats that as "unknown," not "zero," when scoring.
    /// </summary>
    public double? MeasuredAverageTickMs { get; set; }

    public Package? Package { get; set; }

    public ICollection<PackageDependency> Dependencies { get; set; } = new List<PackageDependency>();
}

/// <summary>The closed set of <see cref="PackageVersion.ScanStatus"/> values (docs/SPEC.md Section 10.4's publish pipeline gates).</summary>
public static class PackageScanStatus
{
    public const string Pending = "pending";
    /// <summary>Claimed by one gate 4 scanner instance (services/Forge.Functions.Scan) — the atomic claim transition that keeps two horizontally-scaled instances from picking up the same row (CLAUDE.md Section 1.5 guardrail 20).</summary>
    public const string Scanning = "scanning";
    public const string Passed = "passed";
    /// <summary>
    /// Gate 5 (docs/SPEC.md Section 10.4's reputation gate, M7 Phase 3):
    /// the version cleared gate 4's sandboxed smoke run, but its
    /// author's <see cref="Marketplace.AuthorTrustTier"/> is
    /// <see cref="Marketplace.AuthorTrustTier.Unverified"/> — "new
    /// authors: manual review queue," per the SPEC's own gate 5
    /// description. A version sits here until a human reviewer promotes
    /// it to <see cref="Passed"/>; the review endpoint/reviewer role
    /// itself is a stated, separate follow-up (M7 Phase 3 scope is the
    /// trust-tier calculation and routing into this queue, not yet the
    /// review UI/authorization model for who empties it).
    /// </summary>
    public const string Flagged = "flagged";
    public const string Blocked = "blocked";
}
