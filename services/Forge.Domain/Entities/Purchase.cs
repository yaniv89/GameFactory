namespace Forge.Domain.Entities;

/// <summary>
/// docs/SPEC.md Section 6.2's <c>purchases</c> table: one row per
/// checkout attempt against a paid <see cref="Listing"/>. Created
/// <see cref="PurchaseStatus.Pending"/> the moment a Checkout Session is
/// created (before the buyer has actually paid — the session response
/// is never proof of payment, CLAUDE.md Section 1.1 guardrail 4) and
/// only ever flipped to <see cref="PurchaseStatus.Succeeded"/> by the
/// signature-verified Stripe webhook, the same posture
/// <see cref="Subscription"/> already uses.
/// </summary>
public sealed class Purchase
{
    public Guid Id { get; set; }

    /// <summary>The buying workspace — this is what the resulting <see cref="License"/> is granted to.</summary>
    public Guid WorkspaceId { get; set; }

    /// <summary>The individual user who initiated the checkout — distinct from <see cref="WorkspaceId"/>, since a purchase is attributed to a person even though the license benefits the whole workspace.</summary>
    public Guid BuyerUserId { get; set; }

    public Guid PackageId { get; set; }

    public int AmountCents { get; set; }

    public required string Currency { get; set; }

    /// <summary>The author's share of <see cref="AmountCents"/> at the <see cref="Listing.RevenueShareBps"/> in effect when this purchase was created — captured here, not recomputed later, so a subsequent listing price/share change never rewrites the economics of a completed sale.</summary>
    public int AuthorShareCents { get; set; }

    public required string StripePaymentIntent { get; set; }

    /// <summary>pending | succeeded | refunded | disputed. See <see cref="PurchaseStatus"/>.</summary>
    public required string Status { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public Workspace? Workspace { get; set; }

    public User? Buyer { get; set; }

    public Package? Package { get; set; }
}

/// <summary>The closed set of <see cref="Purchase.Status"/> values.</summary>
public static class PurchaseStatus
{
    public const string Pending = "pending";
    public const string Succeeded = "succeeded";
    public const string Refunded = "refunded";
    public const string Disputed = "disputed";

    public static readonly IReadOnlySet<string> All = new HashSet<string>([Pending, Succeeded, Refunded, Disputed]);

    /// <summary>Backs an author's earnings total (M7 Phase 5) — a disputed purchase is excluded until Stripe resolves it, the same way a refunded one is excluded permanently.</summary>
    public static readonly IReadOnlySet<string> CountsTowardEarnings = new HashSet<string>([Succeeded]);
}
