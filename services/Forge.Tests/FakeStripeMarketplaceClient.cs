using Forge.Infrastructure.Billing;

namespace Forge.Tests;

/// <summary>
/// Test double for <see cref="IStripeMarketplaceClient"/> — same posture as
/// <see cref="FakeStripeBillingClient"/>: no real Stripe test-mode API key
/// exists in this environment, so nothing here calls the real Stripe API.
/// Records what would have been requested so tests can assert on it, and
/// returns deterministic fake Stripe-shaped ids/URLs a webhook test can
/// then feed back in as the correlating <c>payment_intent</c>.
/// </summary>
public sealed class FakeStripeMarketplaceClient : IStripeMarketplaceClient
{
    private readonly List<CreateConnectAccountLinkRequest> _connectRequests = [];
    private readonly List<CreatePurchaseCheckoutSessionRequest> _checkoutRequests = [];

    public IReadOnlyList<CreateConnectAccountLinkRequest> ConnectRequests
    {
        get { lock (_connectRequests) return [.. _connectRequests]; }
    }

    public IReadOnlyList<CreatePurchaseCheckoutSessionRequest> CheckoutRequests
    {
        get { lock (_checkoutRequests) return [.. _checkoutRequests]; }
    }

    public Task<ConnectAccountLinkResult> CreateConnectAccountLinkAsync(CreateConnectAccountLinkRequest request, CancellationToken ct)
    {
        lock (_connectRequests) _connectRequests.Add(request);
        var accountId = request.ExistingStripeAccountId ?? $"acct_{Guid.NewGuid():N}";
        return Task.FromResult(new ConnectAccountLinkResult(accountId, $"https://connect.stripe.com/fake/{Guid.NewGuid():N}"));
    }

    public Task<PurchaseCheckoutSessionResult> CreatePurchaseCheckoutSessionAsync(CreatePurchaseCheckoutSessionRequest request, CancellationToken ct)
    {
        lock (_checkoutRequests) _checkoutRequests.Add(request);
        var sessionUrl = $"https://checkout.stripe.com/fake/{Guid.NewGuid():N}";
        var paymentIntentId = $"pi_{Guid.NewGuid():N}";
        return Task.FromResult(new PurchaseCheckoutSessionResult(sessionUrl, paymentIntentId));
    }
}
