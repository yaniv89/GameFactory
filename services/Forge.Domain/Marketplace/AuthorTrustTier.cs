namespace Forge.Domain.Marketplace;

/// <summary>docs/SPEC.md Section 16.3's three author trust tiers.</summary>
public static class AuthorTrustTier
{
    public const string Unverified = "unverified";
    public const string Verified = "verified";
    public const string Partner = "partner";

    public static readonly IReadOnlySet<string> All = new HashSet<string>([Unverified, Verified, Partner]);
}
