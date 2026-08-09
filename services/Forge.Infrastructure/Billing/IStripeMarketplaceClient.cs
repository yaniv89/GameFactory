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
}
