namespace Forge.Domain.Marketplace;

/// <summary>
/// Everything docs/SPEC.md Section 16.3's tier requirements need,
/// gathered from wherever each signal actually lives (Identity's own
/// store for 2FA, the domain <c>User</c> row for identity verification
/// and audit/SLA acceptance, a query over <c>PackageVersion</c> for
/// publishing tenure) — deliberately not a method on <c>User</c> itself,
/// so <see cref="AuthorTrustTierCalculator"/> stays a pure function
/// callers can unit test without a database.
/// </summary>
/// <param name="TwoFactorEnabled">From <c>ForgeIdentityUser.TwoFactorEnabled</c> (ASP.NET Core Identity's own built-in field) — not duplicated onto the domain <c>User</c> row.</param>
/// <param name="IdentityVerified">Whether an external identity-verification step has completed. No verification provider is wired up yet (a real, separate integration, e.g. Stripe Identity) — this is always <c>false</c> until that lands; a stated gap, not a silently-assumed pass.</param>
/// <param name="FirstPublishedAt">When this author's first package version was published — <c>null</c> if they have never published. Drives the "3 months" tenure requirement.</param>
/// <param name="RefundRate">0.0-1.0. <c>0</c> when the author has no purchases yet — docs/SPEC.md Section 16.1's marketplace purchase flow doesn't exist until M7 Phase 4/5, so this is always <c>0</c> until real Stripe Connect refund data exists. A stated gap, not an assumption of a perfect record.</param>
/// <param name="SecurityAuditPassed">Section 16.3's Partner-tier requirement. No audit-tracking workflow exists yet — always <c>false</c> until it does.</param>
/// <param name="SlaAccepted">Section 16.3's Partner-tier requirement. No SLA-acceptance flow exists yet — always <c>false</c> until it does.</param>
public sealed record AuthorTrustSignals(
    bool TwoFactorEnabled,
    bool IdentityVerified,
    DateTimeOffset? FirstPublishedAt,
    double RefundRate,
    bool SecurityAuditPassed,
    bool SlaAccepted);
