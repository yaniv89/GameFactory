namespace Forge.Domain.Entities;

/// <summary>
/// docs/SPEC.md Section 6.2's <c>licenses</c> table: proof that
/// <see cref="WorkspaceId"/> may install <see cref="PackageId"/>. Created
/// by the Stripe webhook the moment a <see cref="Purchase"/> succeeds
/// (<see cref="LicenseGrantedVia.Purchase"/>) — the other
/// <see cref="LicenseGrantedVia"/> values exist in the schema for
/// non-purchase grants (bundles, gifts, trials) but nothing in this
/// codebase issues those yet, a stated gap, not a silent one.
/// </summary>
public sealed class License
{
    public Guid Id { get; set; }

    public Guid PackageId { get; set; }

    public Guid WorkspaceId { get; set; }

    /// <summary>purchase | bundle | gift | trial. See <see cref="LicenseGrantedVia"/>.</summary>
    public required string GrantedVia { get; set; }

    /// <summary>Set when <see cref="GrantedVia"/> is <see cref="LicenseGrantedVia.Purchase"/>; null for every other grant path.</summary>
    public Guid? PurchaseId { get; set; }

    /// <summary>Null means perpetual — the only kind this codebase issues so far (a purchased license never expires).</summary>
    public DateTimeOffset? ExpiresAt { get; set; }

    public DateTimeOffset GrantedAt { get; set; }

    /// <summary>Set on a refund (docs/SPEC.md Section 16.1's 14-day, creator-initiated refund window) — a revoked license still exists as a record, it just no longer grants access (see <see cref="License"/>-consuming code's own filter on this).</summary>
    public DateTimeOffset? RevokedAt { get; set; }

    public Package? Package { get; set; }

    public Workspace? Workspace { get; set; }

    public Purchase? Purchase { get; set; }
}

/// <summary>The closed set of <see cref="License.GrantedVia"/> values.</summary>
public static class LicenseGrantedVia
{
    public const string Purchase = "purchase";
    public const string Bundle = "bundle";
    public const string Gift = "gift";
    public const string Trial = "trial";

    public static readonly IReadOnlySet<string> All = new HashSet<string>([Purchase, Bundle, Gift, Trial]);
}
