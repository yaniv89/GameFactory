namespace Forge.Infrastructure.Billing;

public sealed record CreateConnectAccountLinkRequest(
    string? ExistingStripeAccountId,
    string Email,
    string RefreshUrl,
    string ReturnUrl);

public sealed record ConnectAccountLinkResult(string StripeAccountId, string OnboardingUrl);

public sealed record CreatePurchaseCheckoutSessionRequest(
    string PackageDisplayName,
    int AmountCents,
    string Currency,
    string ConnectedStripeAccountId,
    int ApplicationFeeCents,
    string BuyerEmail,
    Guid WorkspaceId,
    Guid PackageId,
    string SuccessUrl,
    string CancelUrl);

public sealed record PurchaseCheckoutSessionResult(string SessionUrl, string StripePaymentIntentId);

/// <summary>
/// One row of a connected account's real Stripe payout history — money
/// actually swept from the connected account's Stripe balance to the
/// author's bank account, not the earlier destination-charge transfer
/// that only moves funds into that Stripe balance (docs/SPEC.md Section
/// 16.1 draws exactly this distinction: "Payment processing: Stripe
/// Connect, passed through" vs. "Payout schedule: Net 30, minimum $50" —
/// two different hops of the same dollar). <see cref="Status"/> is
/// Stripe's own payout status string (<c>paid</c>, <c>pending</c>,
/// <c>in_transit</c>, <c>canceled</c>, <c>failed</c>) passed through
/// unedited rather than re-modeled, so a status Stripe adds later isn't
/// silently coerced into an unrelated one here.
/// </summary>
public sealed record PayoutRecord(string StripePayoutId, int AmountCents, string Currency, string Status, DateTimeOffset ArrivalDate);

/// <summary>
/// docs/SPEC.md Section 16.1's "Stripe Connect, passed through" for
/// marketplace purchases — distinct from <see cref="IStripeBillingClient"/>
/// (subscription billing, M5 Phase 5): different Stripe API surface
/// (Connect accounts + destination-charge Checkout Sessions in
/// <c>mode=payment</c>, vs. plain <c>mode=subscription</c> Checkout), and
/// a real conceptual split this codebase already draws elsewhere —
/// <see cref="Domain.Entities.User.StripeAccount"/> (an Author's Connect
/// account, for receiving marketplace payouts) is explicitly documented
/// as distinct from <see cref="Domain.Entities.User.StripeCustomerId"/>
/// (that same person's own subscription billing identity). Behind an
/// interface for the same reason <see cref="IStripeBillingClient"/> is:
/// no real Stripe test-mode API key exists in this sandbox, so
/// <see cref="StripeMarketplaceClient"/> is the real implementation and
/// Forge.Tests has a hand-written fake.
/// </summary>
public interface IStripeMarketplaceClient
{
    /// <summary>
    /// Creates (or reuses, via <paramref name="request"/>'s <c>ExistingStripeAccountId</c>)
    /// a Stripe Connect Express account for an author and returns a
    /// fresh onboarding link — Stripe account-links expire and are
    /// single-use, so this is called again each time an author needs to
    /// (re)start or resume onboarding, never cached.
    /// </summary>
    Task<ConnectAccountLinkResult> CreateConnectAccountLinkAsync(CreateConnectAccountLinkRequest request, CancellationToken ct);

    /// <summary>
    /// A <c>mode=payment</c> Checkout Session with a destination charge
    /// (<c>payment_intent_data.transfer_data.destination</c> = the
    /// author's connected account, <c>application_fee_amount</c> = the
    /// platform's cut) — a single charge on the platform's own Stripe
    /// account with an automatic transfer to the author, which is what
    /// "passed through" (Section 16.1) actually means mechanically: the
    /// platform never separately re-transfers funds itself.
    /// </summary>
    Task<PurchaseCheckoutSessionResult> CreatePurchaseCheckoutSessionAsync(CreatePurchaseCheckoutSessionRequest request, CancellationToken ct);

    /// <summary>
    /// Real payout history for a connected account, queried live from
    /// Stripe rather than mirrored into a second, platform-owned ledger
    /// that could drift out of sync with what Stripe itself considers
    /// authoritative — the same reasoning docs/SPEC.md Section 5.5 (no
    /// duplicated source of truth for state another system already owns)
    /// applies here, not just to in-process caches. Most-recent-first,
    /// same ordering Stripe's own List API returns by default.
    /// </summary>
    Task<IReadOnlyList<PayoutRecord>> ListPayoutsAsync(string connectedStripeAccountId, CancellationToken ct);
}
