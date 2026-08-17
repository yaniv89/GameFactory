namespace Forge.Domain.Marketplace;

/// <summary>
/// docs/SPEC.md Section 16.2's weighted listing-quality score — "ranking
/// is not by download count alone, which rewards incumbency and
/// encourages gaming."
///
/// Of the seven signals the SPEC weights, F1 gave two
/// (<see cref="ListingQualitySignals.ActiveInstalls30d"/>,
/// <see cref="ListingQualitySignals.BayesianRating"/>) a real data source
/// for the first time — <see cref="Entities.License"/> and
/// <see cref="Entities.Review"/> respectively. One
/// (<see cref="ListingQualitySignals.SupportResponsivenessHours"/>) still
/// has none — no issue tracker exists in this platform, and building one
/// was never F1's scope. Rather than fabricate a number for that signal
/// (which would either unfairly floor every package's score by its own
/// share of total weight, achieving nothing but noise, or fake a neutral
/// default that pretends the feature exists), this calculator excludes
/// an absent signal from the weighted average entirely and renormalizes
/// the remaining weights to sum to 1 — the same "don't guess and present
/// it as fact" posture CLAUDE.md Section 0 states directly, applied to a
/// ranking formula instead of a Stripe API surface. The moment a real
/// value exists for support responsiveness too, passing it through
/// <see cref="ListingQualitySignals"/> makes it participate automatically
/// — no change needed here.
///
/// Six real signals now drive the score: active installs (installs are
/// deliberately log-compressed, see <see cref="ActiveInstallsScore"/>,
/// for the same "don't reward sheer incumbency" reason raw download
/// counts are rejected above), a Bayesian-shrunk rating (see
/// <see cref="BayesianRatingScore"/> for why a naive average would let
/// one 5-star review outrank a package with two hundred averaging 4.8),
/// documentation completeness, bundle size cost, maintenance recency,
/// and the measured performance budget — SPEC's own text calls the last
/// of these "novel and valuable... ship it from day one" (Section 16.2),
/// and it's genuinely new: no comparable marketplace publishes a
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

    /// <summary>
    /// The install count that earns full marks — deliberately not tied to
    /// any real observed distribution (there is no real traffic on this
    /// platform yet to calibrate against), so this is a stated, arbitrary
    /// ceiling in the same spirit as <see cref="FullCreditReadmeLength"/>,
    /// not a claim about what "popular" actually means. Log-scaled, not
    /// linear: SPEC 16.2 itself is explicit that ranking must not reward
    /// incumbency, and a raw linear count would let the single most-
    /// installed package dominate this signal for everyone else the same
    /// way raw download count would.
    /// </summary>
    private const int FullCreditInstalls30d = 100;

    /// <summary>
    /// The Bayesian shrinkage prior's weight, in "equivalent reviews" —
    /// standard IMDb-style formula (v/(v+m))*R + (m/(v+m))*C. A package
    /// with fewer than this many reviews gets pulled measurably toward
    /// the platform-wide average rather than trusting its own small
    /// sample; one with many more reviews than this converges on its own
    /// real average. 5 is a stated, defensible floor for "enough reviews
    /// to mean something," the same category of arbitrary-but-argued
    /// constant as <see cref="FullCreditInstalls30d"/>/<see cref="FullCreditReadmeLength"/>.
    /// </summary>
    private const double BayesianShrinkageReviews = 5.0;

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

        if (signals.ActiveInstalls30d is { } installs30d)
        {
            weightedSum += ActiveInstallsWeight * ActiveInstallsScore(installs30d);
            weightTotal += ActiveInstallsWeight;
        }

        if (signals.BayesianRating is { } bayesianRating)
        {
            weightedSum += RatingWeight * BayesianRatingScore(bayesianRating);
            weightTotal += RatingWeight;
        }

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

    /// <summary>
    /// The standard Bayesian/IMDb-style shrinkage estimate:
    /// <c>(v/(v+m))*R + (m/(v+m))*C</c>, where <paramref name="reviewCount"/>
    /// is v, <paramref name="averageRating"/> (this package's own mean) is
    /// R, <see cref="BayesianShrinkageReviews"/> is m, and
    /// <paramref name="globalAverageRating"/> (the platform-wide mean
    /// across every reviewed package) is C. A package with <c>v = 0</c>
    /// collapses to exactly C — fully trusting the platform prior, which
    /// is the honest behavior for "no opinion of its own yet," not an
    /// edge case to special-case around. Lives here, in Domain, rather
    /// than inline in the endpoint that calls it, so it's unit-testable
    /// without EF Core and shares this class's own "arbitrary constant,
    /// stated and argued" discipline for <see cref="BayesianShrinkageReviews"/>.
    /// The result is a real 1-5 number — <see cref="ListingQualitySignals.BayesianRating"/>'s
    /// own doc comment — ready to hand back into <see cref="CalculateScore"/>
    /// via a fresh <see cref="ListingQualitySignals"/>, not something
    /// <see cref="CalculateScore"/> derives itself.
    /// </summary>
    public static double CalculateBayesianRating(int reviewCount, double averageRating, double globalAverageRating)
    {
        if (reviewCount <= 0) return globalAverageRating;
        double v = reviewCount;
        var shrunk = (v / (v + BayesianShrinkageReviews) * averageRating) + (BayesianShrinkageReviews / (v + BayesianShrinkageReviews) * globalAverageRating);
        return Math.Clamp(shrunk, 1.0, 5.0);
    }

    private static double ActiveInstallsScore(int installs) =>
        Math.Clamp(Math.Log(1 + Math.Max(0, installs)) / Math.Log(1 + FullCreditInstalls30d), 0.0, 1.0);

    /// <summary>Maps an already-shrunk (<see cref="CalculateBayesianRating"/>) 1-5 rating onto this calculator's 0..1 scale.</summary>
    private static double BayesianRatingScore(double bayesianRating) =>
        Math.Clamp((bayesianRating - 1.0) / 4.0, 0.0, 1.0);

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
