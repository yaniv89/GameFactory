using Forge.Domain.Marketplace;
using Xunit;

namespace Forge.Tests.Marketplace;

public sealed class AuthorTrustTierCalculatorTests
{
    private static readonly DateTimeOffset Now = new(2026, 8, 9, 0, 0, 0, TimeSpan.Zero);

    private static AuthorTrustSignals FullyQualifiedPartnerSignals() => new(
        TwoFactorEnabled: true,
        IdentityVerified: true,
        FirstPublishedAt: Now.AddDays(-91),
        RefundRate: 0.0,
        SecurityAuditPassed: true,
        SlaAccepted: true);

    [Fact]
    public void A_Brand_New_Author_With_No_Signals_Is_Unverified()
    {
        var signals = new AuthorTrustSignals(false, false, null, 0.0, false, false);
        Assert.Equal(AuthorTrustTier.Unverified, AuthorTrustTierCalculator.Calculate(signals, Now));
    }

    [Fact]
    public void Meeting_Every_Verified_Requirement_But_Not_Partners_Extra_Two_Yields_Verified()
    {
        var signals = FullyQualifiedPartnerSignals() with { SecurityAuditPassed = false, SlaAccepted = false };
        Assert.Equal(AuthorTrustTier.Verified, AuthorTrustTierCalculator.Calculate(signals, Now));
    }

    [Fact]
    public void Meeting_Every_Requirement_Including_Audit_And_Sla_Yields_Partner()
    {
        Assert.Equal(AuthorTrustTier.Partner, AuthorTrustTierCalculator.Calculate(FullyQualifiedPartnerSignals(), Now));
    }

    [Theory]
    [InlineData(false, true, true)] // missing 2FA
    [InlineData(true, false, true)] // missing identity verification
    [InlineData(true, true, false)] // refund rate at/above 1%
    public void Missing_Any_One_Verified_Requirement_Falls_Back_To_Unverified(bool twoFactor, bool identityVerified, bool refundOk)
    {
        var signals = new AuthorTrustSignals(
            TwoFactorEnabled: twoFactor,
            IdentityVerified: identityVerified,
            FirstPublishedAt: Now.AddDays(-91),
            RefundRate: refundOk ? 0.0 : 0.02,
            SecurityAuditPassed: false,
            SlaAccepted: false);

        Assert.Equal(AuthorTrustTier.Unverified, AuthorTrustTierCalculator.Calculate(signals, Now));
    }

    [Fact]
    public void An_Author_Who_Has_Never_Published_Cannot_Reach_Verified_Even_With_Every_Other_Box_Checked()
    {
        var signals = FullyQualifiedPartnerSignals() with { FirstPublishedAt = null };
        Assert.Equal(AuthorTrustTier.Unverified, AuthorTrustTierCalculator.Calculate(signals, Now));
    }

    [Fact]
    public void Exactly_Ninety_Days_Tenure_Is_Enough_A_Single_Day_Short_Is_Not()
    {
        var qualifying = FullyQualifiedPartnerSignals() with { FirstPublishedAt = Now.AddDays(-90) };
        Assert.NotEqual(AuthorTrustTier.Unverified, AuthorTrustTierCalculator.Calculate(qualifying, Now));

        var oneDayShort = FullyQualifiedPartnerSignals() with { FirstPublishedAt = Now.AddDays(-89) };
        Assert.Equal(AuthorTrustTier.Unverified, AuthorTrustTierCalculator.Calculate(oneDayShort, Now));
    }

    [Fact]
    public void A_Refund_Rate_Exactly_At_One_Percent_Does_Not_Qualify_Strictly_Under_Is_Required()
    {
        var atThreshold = FullyQualifiedPartnerSignals() with { RefundRate = 0.01 };
        Assert.Equal(AuthorTrustTier.Unverified, AuthorTrustTierCalculator.Calculate(atThreshold, Now));

        var justUnder = FullyQualifiedPartnerSignals() with { RefundRate = 0.0099 };
        Assert.NotEqual(AuthorTrustTier.Unverified, AuthorTrustTierCalculator.Calculate(justUnder, Now));
    }
}
