namespace Forge.Domain.Entities;

/// <summary>
/// The domain projection of an account (docs/SPEC.md Section 6.2, Section
/// 23.1). Deliberately not ASP.NET Core Identity's own store — Identity
/// owns password hashes and security stamps, this table owns everything
/// the rest of the domain (workspaces, projects, marketplace payouts)
/// actually needs to reference. The two are linked by
/// <see cref="IdentitySubjectId"/>, the token's `sub` claim, so a
/// federated-login user and a local-password user share this exact row
/// shape (Section 23.4).
/// </summary>
public sealed class User
{
    public Guid Id { get; set; }

    /// <summary>The `sub` claim from OpenIddict/ASP.NET Core Identity.</summary>
    public required string IdentitySubjectId { get; set; }

    /// <summary>Case-insensitive (Postgres citext), unique.</summary>
    public required string Email { get; set; }

    /// <summary>
    /// Null means unverified. Gates publishing (Section 16.3) and
    /// starting a billing checkout (Section 23.3/23.5).
    /// </summary>
    public DateTimeOffset? EmailVerifiedAt { get; set; }

    public required string DisplayName { get; set; }

    public string? AvatarUrl { get; set; }

    /// <summary>Stripe Connect account, for marketplace payouts as an Author. Distinct from <see cref="Subscription.StripeCustomerId"/>.</summary>
    public string? StripeAccount { get; set; }

    /// <summary>Stripe customer for this user's own subscription billing. Distinct from <see cref="StripeAccount"/>.</summary>
    public string? StripeCustomerId { get; set; }

    /// <summary>
    /// docs/SPEC.md Section 16.3's Verified/Partner-tier "identity
    /// verified" requirement — an external KYC-style verification step
    /// (e.g. Stripe Identity). No verification provider is wired up yet
    /// (M7 Phase 3 scope: the trust-tier <i>calculation</i>, not the
    /// verification UX/integration) — this stays null for every author
    /// until that lands, a stated gap rather than an assumed pass. See
    /// <see cref="Marketplace.AuthorTrustSignals"/>.
    /// </summary>
    public DateTimeOffset? IdentityVerifiedAt { get; set; }

    /// <summary>docs/SPEC.md Section 16.3's Partner-tier security-audit requirement. No audit-tracking workflow exists yet — same stated-gap posture as <see cref="IdentityVerifiedAt"/>.</summary>
    public DateTimeOffset? SecurityAuditPassedAt { get; set; }

    /// <summary>docs/SPEC.md Section 16.3's Partner-tier SLA requirement. No SLA-acceptance flow exists yet — same stated-gap posture as <see cref="IdentityVerifiedAt"/>.</summary>
    public DateTimeOffset? SlaAcceptedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }
}
