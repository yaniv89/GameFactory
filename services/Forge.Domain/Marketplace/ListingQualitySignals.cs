namespace Forge.Domain.Marketplace;

/// <summary>
/// docs/SPEC.md Section 16.2's seven weighted ranking signals for one
/// package's latest resolvable version. Every field is nullable because
/// every field can be genuinely unknown — a brand-new package has no
/// version yet, a version that hasn't cleared gate 4 has no measured
/// frame cost, and three of these signals (<see cref="ActiveInstalls30d"/>,
/// <see cref="BayesianRating"/>, <see cref="SupportResponsivenessHours"/>)
/// have no data source anywhere in this platform yet — no install-event
/// tracking, no ratings/reviews subsystem, no issue tracker. Passing
/// <c>null</c> for those three is not a placeholder for "implement this
/// later," it's the literal true state: this signal has never been
/// computed for any package, not just this one. See
/// <see cref="PackageRankingCalculator"/>'s own doc comment for how it
/// handles that.
/// </summary>
/// <param name="ActiveInstalls30d">Not implemented — no install-event tracking exists in this platform yet. Always null.</param>
/// <param name="BayesianRating">Not implemented — no ratings/reviews subsystem exists yet. Always null.</param>
/// <param name="LatestVersionPublishedAt">When the package's newest non-yanked version was published — the real signal <see cref="PackageRankingCalculator"/> uses as a maintenance-recency proxy, since this platform has no "current engine version" registry to compare a version's engine range against (docs/SPEC.md's own literal mechanism for this signal).</param>
/// <param name="MeasuredAverageTickMs"><see cref="Entities.PackageVersion.MeasuredAverageTickMs"/> of the latest non-yanked, gate-4-measured version. Null if no version has ever completed a smoke run.</param>
/// <param name="LatestVersionSizeBytes"><see cref="Entities.PackageVersion.SizeBytes"/> of the latest non-yanked version.</param>
/// <param name="ReadmeLength">Character count of <see cref="Entities.Package.ReadmeMarkdown"/>, 0 if absent.</param>
/// <param name="SupportResponsivenessHours">Not implemented — no issue-tracking system exists in this platform. Always null.</param>
public sealed record ListingQualitySignals(
    int? ActiveInstalls30d,
    double? BayesianRating,
    DateTimeOffset? LatestVersionPublishedAt,
    double? MeasuredAverageTickMs,
    int? LatestVersionSizeBytes,
    int ReadmeLength,
    double? SupportResponsivenessHours);
