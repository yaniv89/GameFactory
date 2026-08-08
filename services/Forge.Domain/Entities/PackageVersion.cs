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

    public Package? Package { get; set; }

    public ICollection<PackageDependency> Dependencies { get; set; } = new List<PackageDependency>();
}

/// <summary>The closed set of <see cref="PackageVersion.ScanStatus"/> values (docs/SPEC.md Section 10.4's publish pipeline gates).</summary>
public static class PackageScanStatus
{
    public const string Pending = "pending";
    public const string Passed = "passed";
    public const string Flagged = "flagged";
    public const string Blocked = "blocked";
}
