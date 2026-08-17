namespace Forge.Domain.Marketplace;

/// <summary>
/// docs/SPEC.md Section 16.2's seven weighted ranking signals for one
/// package's latest resolvable version. Every field is nullable because
/// every field can be genuinely unknown — a brand-new package has no
/// version yet, a version that hasn't cleared gate 4 has no measured
/// frame cost. As of F1, two of the three signals this record's own
/// history once had no data source for — <see cref="ActiveInstalls30d"/>
/// (real, from <see cref="Entities.License"/>) and
/// <see cref="BayesianRating"/> (real, from <see cref="Entities.Review"/>)
/// — are real. <see cref="SupportResponsivenessHours"/> still has none:
/// no issue-tracking system exists in this platform, and F1's own scope
/// was reviews and install tracking specifically, not a support/issue
/// subsystem. Passing <c>null</c> for that one is not a placeholder for
/// "implement this later," it's the literal true state. See
/// <see cref="PackageRankingCalculator"/>'s own doc comment for how it
/// handles an absent signal.
/// </summary>
/// <param name="ActiveInstalls30d">Distinct workspaces holding a non-revoked <see cref="Entities.License"/> for this package, granted within the last 30 days (docs/SPEC.md Section 16.2's own "retained usage, not raw downloads" framing — excluding revoked/refunded licenses is exactly what makes this "retained" rather than "ever purchased"). Real, computed value — including a real <c>0</c> for a package nobody has installed recently, which is not the same as "unknown" and does participate in the score. Free packages have no <see cref="Entities.License"/> rows at all yet (nothing in this platform tracks a free install) — their true value here is <c>0</c>, an honest reading of "no tracked installs," not a gap hidden behind null.</param>
/// <param name="BayesianRating">A Bayesian-shrunk 1-5 estimate from this package's own <see cref="Entities.Review"/> rows, pulled toward the platform-wide average rating in proportion to how few reviews this specific package has (<see cref="PackageRankingCalculator"/>'s own doc comment has the exact formula and why) — the standard mitigation for "one 5-star review shouldn't outrank a package with two hundred reviews averaging 4.8." Null only when no package on the whole platform has any reviews yet, since there is then no prior to shrink toward at all.</param>
/// <param name="LatestVersionPublishedAt">When the package's newest non-yanked version was published — the real signal <see cref="PackageRankingCalculator"/> uses as a maintenance-recency proxy, since this platform has no "current engine version" registry to compare a version's engine range against (docs/SPEC.md's own literal mechanism for this signal).</param>
/// <param name="MeasuredAverageTickMs"><see cref="Entities.PackageVersion.MeasuredAverageTickMs"/> of the latest non-yanked, gate-4-measured version. Null if no version has ever completed a smoke run.</param>
/// <param name="LatestVersionSizeBytes"><see cref="Entities.PackageVersion.SizeBytes"/> of the latest non-yanked version.</param>
/// <param name="ReadmeLength">Character count of <see cref="Entities.Package.ReadmeMarkdown"/>, 0 if absent.</param>
/// <param name="SupportResponsivenessHours">Not implemented — no issue-tracking system exists in this platform, and F1's scope didn't build one. Always null.</param>
public sealed record ListingQualitySignals(
    int? ActiveInstalls30d,
    double? BayesianRating,
    DateTimeOffset? LatestVersionPublishedAt,
    double? MeasuredAverageTickMs,
    int? LatestVersionSizeBytes,
    int ReadmeLength,
    double? SupportResponsivenessHours);
