namespace Forge.Domain.Marketplace;

/// <summary>
/// docs/SPEC.md Section 16.2's weighted listing-quality score — "ranking
/// is not by download count alone, which rewards incumbency and
/// encourages gaming."
///
/// Of the seven signals the SPEC weights, three
/// (<see cref="ListingQualitySignals.ActiveInstalls30d"/>,
/// <see cref="ListingQualitySignals.BayesianRating"/>,
/// <see cref="ListingQualitySignals.SupportResponsivenessHours"/>) have
/// no data source anywhere in this platform — no install-event tracking,
/// no ratings/reviews subsystem, no issue tracker. Rather than fabricate
/// a number for a signal that has never been measured for any package
/// (which would either unfairly floor every package's score by the same
/// 55% of total weight, achieving nothing but noise, or fake a neutral
/// "nobody's rated it yet" default that pretends the rating feature
/// exists), this calculator excludes an absent signal from the weighted
/// average entirely and renormalizes the remaining weights to sum to 1 —
/// the same "don't guess and present it as fact" posture CLAUDE.md
/// Section 0 states directly, applied to a ranking formula instead of a
/// Stripe API surface. The moment a real value exists for any of those
/// three, passing it through <see cref="ListingQualitySignals"/> makes it
/// participate automatically — no change needed here.
///
/// Today, that leaves four real signals actually driving the score:
/// documentation completeness, bundle size cost, maintenance recency,
/// and the measured performance budget — SPEC's own text calls the
/// last of these "novel and valuable... ship it from day one" (Section
/// 16.2), and it's genuinely new: no comparable marketplace publishes a
/// module's measured frame cost.
/// </summary>
public static class PackageRankingCalculator
{
    private const double ActiveInstallsWeight = 0.25;
    private const double RatingWeight = 0.20;
    private const double MaintenanceRecencyWeight = 0.15;
    private const double PerformanceBudgetWeight = 0.15;
    private const double BundleSizeCostWeight = 0.10;
    private const double SupportResponsivenessWeight = 0.10;
    private const double DocumentationCompletenessWeight = 0.05;

    /// <summary>A version published within this window scores full marks for maintenance recency.</summary>
    private static readonly TimeSpan RecencyFullScoreWindow = TimeSpan.FromDays(90);

    /// <summary>A version this old or older scores zero for maintenance recency — decays linearly between the two windows.</summary>
    private static readonly TimeSpan RecencyZeroScoreWindow = TimeSpan.FromDays(365);

    /// <summary>CLAUDE.md Section 7's per-module frame budget hard-fail line — a version measuring at or above this scores zero for performance.</summary>
    private const double PerformanceKillBudgetMs = 2.0;

    /// <summary>Mirrors PublishVersionEndpoint's own MaxBundleBytes (5 MB) — the ceiling a bundle is rejected at, so it's also the natural ceiling for "how much bundle size is too much" here. The two constants aren't shared code (Forge.Domain doesn't depend on Forge.Api), so a change to one won't automatically update the other — a real, accepted coupling, not a silent one.</summary>
    private const int MaxBundleBytes = 5 * 1024 * 1024;

    /// <summary>An automated heuristic threshold for "full credit" documentation length — docs/SPEC.md specifies only that this signal is "an automated heuristic on the readme," not an exact number; ~300 words is a defensible, arbitrary floor for "this readme actually explains something."</summary>
    private const int FullCreditReadmeLength = 1500;

    /// <summary>
    /// A 0..1 composite score, higher is better. Returns 0.0 only if
    /// every signal were null, which shouldn't happen in practice since
    /// <see cref="ListingQualitySignals.ReadmeLength"/> is never null
    /// (an absent readme is a real, meaningful 0-length reading, not an
    /// unknown one) — callers should only score packages that have at
    /// least one published, passed version in the first place.
    /// </summary>
    public static double CalculateScore(ListingQualitySignals signals, DateTimeOffset now)
    {
        double weightedSum = 0;
        double weightTotal = 0;

        // ActiveInstalls30d and BayesianRating: no data source yet — see
        // this class's own doc comment. Deliberately never contribute.

        if (signals.LatestVersionPublishedAt is { } publishedAt)
        {
            weightedSum += MaintenanceRecencyWeight * MaintenanceRecencyScore(publishedAt, now);
            weightTotal += MaintenanceRecencyWeight;
        }

        if (signals.MeasuredAverageTickMs is { } avgTickMs)
        {
            weightedSum += PerformanceBudgetWeight * PerformanceScore(avgTickMs);
            weightTotal += PerformanceBudgetWeight;
        }

        if (signals.LatestVersionSizeBytes is { } sizeBytes)
        {
            weightedSum += BundleSizeCostWeight * BundleSizeScore(sizeBytes);
            weightTotal += BundleSizeCostWeight;
        }

        // SupportResponsivenessHours: no data source yet — see this
        // class's own doc comment. Deliberately never contributes.

        weightedSum += DocumentationCompletenessWeight * DocumentationScore(signals.ReadmeLength);
        weightTotal += DocumentationCompletenessWeight;

        return weightTotal > 0 ? weightedSum / weightTotal : 0.0;
    }

    private static double MaintenanceRecencyScore(DateTimeOffset publishedAt, DateTimeOffset now)
    {
        var age = now - publishedAt;
        if (age <= RecencyFullScoreWindow) return 1.0;
        if (age >= RecencyZeroScoreWindow) return 0.0;

        var decayRange = (RecencyZeroScoreWindow - RecencyFullScoreWindow).Ticks;
        var intoDecay = (age - RecencyFullScoreWindow).Ticks;
        return 1.0 - (double)intoDecay / decayRange;
    }

    private static double PerformanceScore(double averageTickMs) =>
        1.0 - Math.Clamp(averageTickMs / PerformanceKillBudgetMs, 0.0, 1.0);

    private static double BundleSizeScore(int sizeBytes) =>
        1.0 - Math.Clamp((double)sizeBytes / MaxBundleBytes, 0.0, 1.0);

    private static double DocumentationScore(int readmeLength) =>
        Math.Clamp((double)readmeLength / FullCreditReadmeLength, 0.0, 1.0);

    /// <summary>
    /// The (weight-renormalized) contribution weights actually in play
    /// among the given <paramref name="signals"/>, for anything that
    /// wants to show its work (e.g. an author-facing "why did I rank
    /// here" breakdown) rather than just the collapsed final number.
    /// Excluded signals report a 0.0 effective weight, not their SPEC
    /// weight — that's the whole point of renormalization.
    /// </summary>
    public static IReadOnlyDictionary<string, double> EffectiveWeights(ListingQualitySignals signals)
    {
        var raw = new Dictionary<string, double>
        {
            ["activeInstalls30d"] = signals.ActiveInstalls30d is not null ? ActiveInstallsWeight : 0.0,
            ["rating"] = signals.BayesianRating is not null ? RatingWeight : 0.0,
            ["maintenanceRecency"] = signals.LatestVersionPublishedAt is not null ? MaintenanceRecencyWeight : 0.0,
            ["performanceBudget"] = signals.MeasuredAverageTickMs is not null ? PerformanceBudgetWeight : 0.0,
            ["bundleSizeCost"] = signals.LatestVersionSizeBytes is not null ? BundleSizeCostWeight : 0.0,
            ["supportResponsiveness"] = signals.SupportResponsivenessHours is not null ? SupportResponsivenessWeight : 0.0,
            ["documentationCompleteness"] = DocumentationCompletenessWeight,
        };

        var total = raw.Values.Sum();
        if (total <= 0) return raw;

        return raw.ToDictionary(kv => kv.Key, kv => kv.Value / total);
    }
}
