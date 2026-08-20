namespace Forge.Domain.Marketplace;

/// <summary>
/// docs/SPEC.md Section 16.2's weighted listing-quality score — "ranking
/// is not by download count alone, which rewards incumbency and
/// encourages gaming."
///
/// All seven signals the SPEC weights now have a real data source. F1
/// gave two (<see cref="ListingQualitySignals.ActiveInstalls30d"/>,
/// <see cref="ListingQualitySignals.BayesianRating"/>) one for the first
/// time — <see cref="Entities.License"/> and <see cref="Entities.Review"/>
/// respectively. The last (<see cref="ListingQualitySignals.SupportResponsivenessHours"/>)
/// closes with the minimal issue tracker <see cref="Entities.PackageIssue"/>
/// backs — median hours from an issue's own <c>CreatedAt</c> to its
/// earliest reply, over issues opened in the last
/// <see cref="ResponsivenessWindow"/>. A package with no replied issues
/// in that window still reports null, not zero — an absent signal is
/// excluded from the weighted average entirely and the remaining weights
/// renormalize to sum to 1, rather than fabricating a number (which
/// would either unfairly floor every package's score by its own share of
/// total weight, achieving nothing but noise, or fake a neutral default
/// that pretends a measurement exists when it doesn't) — the same "don't
/// guess and present it as fact" posture CLAUDE.md Section 0 states
/// directly, applied to a ranking formula instead of a Stripe API
/// surface.
///
/// Every signal drives the score now: active installs (installs are
/// deliberately log-compressed, see <see cref="ActiveInstallsScore"/>,
/// for the same "don't reward sheer incumbency" reason raw download
/// counts are rejected above), a Bayesian-shrunk rating (see
/// <see cref="BayesianRatingScore"/> for why a naive average would let
/// one 5-star review outrank a package with two hundred averaging 4.8),
/// documentation completeness, bundle size cost, maintenance recency,
/// support responsiveness, and the measured performance budget — SPEC's
/// own text calls the last of these "novel and valuable... ship it from
/// day one" (Section 16.2), and it's genuinely new: no comparable
/// marketplace publishes a module's measured frame cost.
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

    /// <summary>An issue answered within this window scores full marks for support responsiveness — a stated, defensible bar for "responded within a business day," the same arbitrary-but-argued category as <see cref="FullCreditInstalls30d"/>.</summary>
    private static readonly TimeSpan ResponsivenessFullScoreWindow = TimeSpan.FromHours(24);

    /// <summary>A response this slow or slower scores zero — a full week with no reply — decays linearly between the two windows, the same shape <see cref="MaintenanceRecencyScore"/> already uses for its own two windows.</summary>
    private static readonly TimeSpan ResponsivenessZeroScoreWindow = TimeSpan.FromHours(24 * 7);

    /// <summary>How far back an issue's own <c>CreatedAt</c> can be and still count toward the responsiveness signal — "recent" behavior, not a package's entire history, the same "last 30/90 days" posture <see cref="FullCreditInstalls30d"/>'s own window and <see cref="RecencyFullScoreWindow"/> already take.</summary>
    public static readonly TimeSpan ResponsivenessWindow = TimeSpan.FromDays(90);

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

        if (signals.SupportResponsivenessHours is { } supportHours)
        {
            weightedSum += SupportResponsivenessWeight * SupportResponsivenessScore(supportHours);
            weightTotal += SupportResponsivenessWeight;
        }

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

    /// <summary>
    /// Median hours-to-first-reply across <paramref name="responseHours"/>
    /// (each entry already <c>(firstReplyAt - issue.CreatedAt).TotalHours</c>
    /// for one issue opened within <see cref="ResponsivenessWindow"/> that
    /// has at least one reply — <c>ListPackagesEndpoint</c>'s own query
    /// builds exactly that list). Median, not mean, for the same reason
    /// <see cref="CalculateBayesianRating"/> shrinks rather than averages
    /// raw: one abandoned issue that never got a reply is already excluded
    /// by the caller's own filter, but one that took three weeks to answer
    /// among otherwise-fast responses would still blow out a mean the way
    /// it can't blow out a median. Returns null for an empty list — "no
    /// replied issues in the window" is an absent signal
    /// (<see cref="ListingQualitySignals.SupportResponsivenessHours"/>'s
    /// own null convention), not a real zero-hours measurement. Lives
    /// here, in Domain, for the same EF-independent-unit-testability
    /// reason <see cref="CalculateBayesianRating"/> does.
    /// </summary>
    public static double? CalculateMedianResponseHours(IReadOnlyList<double> responseHours)
    {
        if (responseHours.Count == 0) return null;
        var sorted = responseHours.OrderBy(h => h).ToArray();
        var mid = sorted.Length / 2;
        return sorted.Length % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2.0;
    }

    /// <summary>Lower is better — maps hours-to-first-reply onto this calculator's 0..1 scale via the same two-window linear decay <see cref="MaintenanceRecencyScore"/> already uses, just inverted (fast is full credit here, not old).</summary>
    private static double SupportResponsivenessScore(double hours)
    {
        if (hours <= ResponsivenessFullScoreWindow.TotalHours) return 1.0;
        if (hours >= ResponsivenessZeroScoreWindow.TotalHours) return 0.0;

        var decayRange = ResponsivenessZeroScoreWindow.TotalHours - ResponsivenessFullScoreWindow.TotalHours;
        var intoDecay = hours - ResponsivenessFullScoreWindow.TotalHours;
        return 1.0 - intoDecay / decayRange;
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
