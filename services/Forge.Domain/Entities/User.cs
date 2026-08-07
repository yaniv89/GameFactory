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

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }
}
