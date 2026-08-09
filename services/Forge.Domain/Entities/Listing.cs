namespace Forge.Domain.Entities;

/// <summary>
/// docs/SPEC.md Section 6.2's <c>listings</c> table: the pricing a
/// <see cref="Package"/> is sold under. One-to-one with <see cref="Package"/>
/// (the package id is this row's own primary key, not a separate
/// surrogate) — every package gets a listing the moment it's created
/// (defaulting to free, per Section 16.1's "unlimited free packages"),
/// not only once an author sets a price.
/// </summary>
public sealed class Listing
{
    public Guid PackageId { get; set; }

    /// <summary>free | one_time | subscription. See <see cref="ListingPricingModel"/>.</summary>
    public required string PricingModel { get; set; }

    /// <summary>0 for a free listing — enforced together with <see cref="PricingModel"/> at the database (docs/SPEC.md Section 6.2's <c>ck_price</c> check constraint), not only in application code.</summary>
    public int PriceCents { get; set; }

    /// <summary>ISO 4217, e.g. <c>USD</c>.</summary>
    public string Currency { get; set; } = "USD";

    /// <summary>Basis points to the author on a sale — 8000 = 80%, docs/SPEC.md Section 16.1's revenue share.</summary>
    public int RevenueShareBps { get; set; } = 8000;

    /// <summary>Unlisted (false) hides the package from marketplace browse/search without yanking any already-published version — existing installs keep working.</summary>
    public bool IsListed { get; set; } = true;

    public Package? Package { get; set; }
}

/// <summary>The closed set of <see cref="Listing.PricingModel"/> values.</summary>
public static class ListingPricingModel
{
    public const string Free = "free";
    public const string OneTime = "one_time";
    public const string Subscription = "subscription";

    public static readonly IReadOnlySet<string> All = new HashSet<string>([Free, OneTime, Subscription]);
}
