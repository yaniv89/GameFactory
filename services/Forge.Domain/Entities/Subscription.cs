namespace Forge.Domain.Entities;

/// <summary>
/// A workspace's platform-subscription state (docs/SPEC.md Section 6.2,
/// Section 23.2/23.5). Stripe is the system of record; this table is a
/// read model kept in sync exclusively by signature-verified Stripe
/// webhook events — it must never be written from a client-supplied plan
/// value or from a checkout-session response the browser itself saw,
/// since that response is not proof of payment (CLAUDE.md Section 1.1
/// guardrail 4).
/// </summary>
public sealed class Subscription
{
    public Guid Id { get; set; }

    public Guid WorkspaceId { get; set; }

    public required string StripeCustomerId { get; set; }

    public string? StripeSubscriptionId { get; set; }

    /// <summary>pro | studio.</summary>
    public required string Plan { get; set; }

    /// <summary>trialing | active | past_due | canceled | incomplete.</summary>
    public required string Status { get; set; }

    public DateTimeOffset? CurrentPeriodEnd { get; set; }

    public bool CancelAtPeriodEnd { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public Workspace? Workspace { get; set; }
}

/// <summary>The closed set of <see cref="Subscription.Status"/> values, and which ones count as "currently paying" for plan-gate checks.</summary>
public static class SubscriptionStatus
{
    public const string Trialing = "trialing";
    public const string Active = "active";
    public const string PastDue = "past_due";
    public const string Canceled = "canceled";
    public const string Incomplete = "incomplete";

    /// <summary>
    /// Statuses that keep Pro/Studio gates open. Matches the partial
    /// unique index in docs/SPEC.md Section 6.2
    /// (<c>ix_subscriptions_active_per_workspace</c>) — a workspace may
    /// have at most one subscription row in this set at a time.
    /// </summary>
    public static readonly IReadOnlySet<string> GatesOpen = new HashSet<string>([Trialing, Active, PastDue]);
}
