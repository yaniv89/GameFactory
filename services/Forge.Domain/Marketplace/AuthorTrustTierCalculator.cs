namespace Forge.Domain.Marketplace;

/// <summary>
/// docs/SPEC.md Section 16.3's tier requirements, applied to
/// <see cref="AuthorTrustSignals"/>. Assumes the caller has already
/// confirmed the author's email is verified — Section 23.3's
/// login/publish gate enforces that separately. Section 16.3's own
/// "Unverified: Email verified" row describes what's required to
/// publish *at all*, not a tier this calculator computes: every author
/// this class is ever asked about has already cleared that bar by
/// virtue of having a version in the publish pipeline.
///
/// "3 months" (Section 16.3) isn't specified more precisely there —
/// interpreted here as three months' tenure since the author's *first
/// published version*, the most natural reading of a trust-building
/// period tied to actual publishing history rather than
/// account-creation date (which says nothing about whether they've ever
/// shipped anything).
/// </summary>
public static class AuthorTrustTierCalculator
{
    private static readonly TimeSpan VerifiedMinTenure = TimeSpan.FromDays(90);
    private const double VerifiedMaxRefundRate = 0.01;

    public static string Calculate(AuthorTrustSignals signals, DateTimeOffset now)
    {
        var meetsVerifiedBar =
            signals.TwoFactorEnabled
            && signals.IdentityVerified
            && Tenure(signals.FirstPublishedAt, now) >= VerifiedMinTenure
            && signals.RefundRate < VerifiedMaxRefundRate;

        if (!meetsVerifiedBar) return AuthorTrustTier.Unverified;

        var meetsPartnerBar = signals.SecurityAuditPassed && signals.SlaAccepted;
        return meetsPartnerBar ? AuthorTrustTier.Partner : AuthorTrustTier.Verified;
    }

    private static TimeSpan Tenure(DateTimeOffset? firstPublishedAt, DateTimeOffset now) =>
        firstPublishedAt is { } publishedAt ? now - publishedAt : TimeSpan.Zero;
}
