using Forge.Domain.Marketplace;
using Xunit;

namespace Forge.Tests.Marketplace;

public sealed class PackageRankingCalculatorTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 9, 0, 0, 0, TimeSpan.Zero);

    private static ListingQualitySignals AllNull(int readmeLength = 0) => new(
        ActiveInstalls30d: null,
        BayesianRating: null,
        LatestVersionPublishedAt: null,
        MeasuredAverageTickMs: null,
        LatestVersionSizeBytes: null,
        ReadmeLength: readmeLength,
        SupportResponsivenessHours: null);

    [Fact]
    public void A_Freshly_Published_Small_Well_Documented_Fast_Package_Scores_Near_The_Top()
    {
        var signals = AllNull(readmeLength: 1500) with
        {
            LatestVersionPublishedAt = Now.AddDays(-1),
            MeasuredAverageTickMs = 0.0,
            LatestVersionSizeBytes = 0,
        };

        var score = PackageRankingCalculator.CalculateScore(signals, Now);

        Assert.Equal(1.0, score, precision: 6);
    }

    [Fact]
    public void A_Stale_Bloated_Slow_Undocumented_Package_Scores_Near_The_Bottom()
    {
        var signals = AllNull(readmeLength: 0) with
        {
            LatestVersionPublishedAt = Now.AddYears(-2),
            MeasuredAverageTickMs = 5.0, // Well past the 2.0ms kill budget.
            LatestVersionSizeBytes = 50 * 1024 * 1024, // Well past the 5MB ceiling.
        };

        var score = PackageRankingCalculator.CalculateScore(signals, Now);

        Assert.Equal(0.0, score, precision: 6);
    }

    [Fact]
    public void Only_The_Documentation_Signal_Is_Always_Present_Every_Other_Absent_Signal_Is_Excluded_Not_Zeroed()
    {
        // Nothing published yet except a readme worth full marks — if
        // absent signals were scored as zero instead of excluded and
        // renormalized, this would come out far below 1.0.
        var signals = AllNull(readmeLength: 1500);

        var score = PackageRankingCalculator.CalculateScore(signals, Now);

        Assert.Equal(1.0, score, precision: 6);
    }

    [Fact]
    public void A_Package_With_Zero_Length_Readme_And_No_Other_Signals_Scores_Zero()
    {
        var signals = AllNull(readmeLength: 0);

        Assert.Equal(0.0, PackageRankingCalculator.CalculateScore(signals, Now));
    }

    [Fact]
    public void Maintenance_Recency_Decays_Linearly_Between_The_Full_And_Zero_Windows()
    {
        // Halfway between the 90-day full-score window and the 365-day
        // zero-score window. Documentation always contributes too (it's
        // the one signal with no null case), so the readme length here
        // is chosen (half of FullCreditReadmeLength) to also score
        // exactly 0.5 — keeping every contributing signal at 0.5 means
        // the weighted average is 0.5 regardless of each one's weight.
        var halfway = Now.AddDays(-(90 + (365 - 90) / 2.0));
        var signals = AllNull(readmeLength: 750) with { LatestVersionPublishedAt = halfway };

        var score = PackageRankingCalculator.CalculateScore(signals, Now);

        Assert.InRange(score, 0.45, 0.55);
    }

    [Fact]
    public void A_Faster_Package_Always_Outranks_An_Otherwise_Identical_Slower_One()
    {
        var fast = AllNull(readmeLength: 500) with { MeasuredAverageTickMs = 0.2 };
        var slow = AllNull(readmeLength: 500) with { MeasuredAverageTickMs = 1.8 };

        Assert.True(
            PackageRankingCalculator.CalculateScore(fast, Now) > PackageRankingCalculator.CalculateScore(slow, Now));
    }

    [Fact]
    public void A_Smaller_Package_Always_Outranks_An_Otherwise_Identical_Larger_One()
    {
        var small = AllNull(readmeLength: 500) with { LatestVersionSizeBytes = 10_000 };
        var large = AllNull(readmeLength: 500) with { LatestVersionSizeBytes = 4_000_000 };

        Assert.True(
            PackageRankingCalculator.CalculateScore(small, Now) > PackageRankingCalculator.CalculateScore(large, Now));
    }

    [Fact]
    public void A_Package_With_More_Active_Installs_Always_Outranks_An_Otherwise_Identical_One_With_Fewer()
    {
        var popular = AllNull(readmeLength: 500) with { ActiveInstalls30d = 80 };
        var niche = AllNull(readmeLength: 500) with { ActiveInstalls30d = 2 };

        Assert.True(
            PackageRankingCalculator.CalculateScore(popular, Now) > PackageRankingCalculator.CalculateScore(niche, Now));
    }

    [Fact]
    public void Active_Installs_Score_Is_Log_Compressed_Not_Linear()
    {
        // Going from 1 to 10 installs (a 10x jump near the bottom of the
        // log curve) should move the score by far more than going from 91
        // to 100 (a similar absolute jump, but the same 10x factor applied
        // near the top of the curve where log-compression has already
        // flattened it out) — proof this signal rejects raw incumbency,
        // per this calculator's own doc comment.
        var low = AllNull(readmeLength: 0) with { ActiveInstalls30d = 1 };
        var lowPlus = AllNull(readmeLength: 0) with { ActiveInstalls30d = 10 };
        var high = AllNull(readmeLength: 0) with { ActiveInstalls30d = 91 };
        var highPlus = AllNull(readmeLength: 0) with { ActiveInstalls30d = 100 };

        var lowDelta = PackageRankingCalculator.CalculateScore(lowPlus, Now) - PackageRankingCalculator.CalculateScore(low, Now);
        var highDelta = PackageRankingCalculator.CalculateScore(highPlus, Now) - PackageRankingCalculator.CalculateScore(high, Now);

        Assert.True(lowDelta > highDelta);
    }

    [Fact]
    public void A_Higher_Rated_Package_Always_Outranks_An_Otherwise_Identical_Lower_Rated_One()
    {
        var loved = AllNull(readmeLength: 500) with { BayesianRating = 4.8 };
        var disliked = AllNull(readmeLength: 500) with { BayesianRating = 2.0 };

        Assert.True(
            PackageRankingCalculator.CalculateScore(loved, Now) > PackageRankingCalculator.CalculateScore(disliked, Now));
    }

    [Fact]
    public void CalculateBayesianRating_With_Zero_Reviews_Collapses_To_The_Global_Average()
    {
        var result = PackageRankingCalculator.CalculateBayesianRating(reviewCount: 0, averageRating: 5.0, globalAverageRating: 3.7);

        Assert.Equal(3.7, result, precision: 6);
    }

    [Fact]
    public void CalculateBayesianRating_With_Few_Reviews_Shrinks_Measurably_Toward_The_Global_Average()
    {
        // One perfect 5-star review shouldn't outrank a package with two
        // hundred reviews averaging 4.8 — the exact scenario this
        // calculator's own doc comment names as the reason this method
        // exists.
        var oneReview = PackageRankingCalculator.CalculateBayesianRating(reviewCount: 1, averageRating: 5.0, globalAverageRating: 3.7);
        var twoHundredReviews = PackageRankingCalculator.CalculateBayesianRating(reviewCount: 200, averageRating: 4.8, globalAverageRating: 3.7);

        Assert.True(twoHundredReviews > oneReview);
    }

    [Fact]
    public void CalculateBayesianRating_With_Many_Reviews_Converges_On_Its_Own_Real_Average()
    {
        var result = PackageRankingCalculator.CalculateBayesianRating(reviewCount: 5000, averageRating: 4.9, globalAverageRating: 3.0);

        Assert.InRange(result, 4.85, 4.9);
    }

    [Fact]
    public void EffectiveWeights_Reports_Zero_For_Every_Signal_With_No_Data_Source_And_Renormalizes_The_Rest()
    {
        var signals = AllNull(readmeLength: 500) with
        {
            LatestVersionPublishedAt = Now,
            MeasuredAverageTickMs = 0.1,
            LatestVersionSizeBytes = 1000,
        };

        var weights = PackageRankingCalculator.EffectiveWeights(signals);

        Assert.Equal(0.0, weights["activeInstalls30d"]);
        Assert.Equal(0.0, weights["rating"]);
        Assert.Equal(0.0, weights["supportResponsiveness"]);
        Assert.True(weights["maintenanceRecency"] > 0);
        Assert.True(weights["performanceBudget"] > 0);
        Assert.True(weights["bundleSizeCost"] > 0);
        Assert.True(weights["documentationCompleteness"] > 0);
        Assert.Equal(1.0, weights.Values.Sum(), precision: 6);
    }
}
