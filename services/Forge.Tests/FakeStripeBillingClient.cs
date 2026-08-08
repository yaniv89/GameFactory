using Forge.Infrastructure.Billing;

namespace Forge.Tests;

/// <summary>
/// Test double for <see cref="IStripeBillingClient"/> — this environment
/// has no real Stripe test-mode API key, so nothing here calls the real
/// Stripe API. Records what would have been requested so tests can
/// assert on it, the same pattern <see cref="CapturingEmailSender"/> uses
/// for <see cref="Forge.Infrastructure.Email.IEmailSender"/>. Proves the
/// billing endpoints' own logic (authorization, validation, plan-to-price
/// mapping, the 404-when-no-subscription-yet path) — not that a real
/// Stripe Checkout/Portal session actually gets created, which nothing in
/// this repo can verify without real credentials.
/// </summary>
public sealed class FakeStripeBillingClient : IStripeBillingClient
{
    private readonly List<CreateCheckoutSessionRequest> _checkoutRequests = [];
    private readonly List<(string StripeCustomerId, string ReturnUrl)> _portalRequests = [];

    public IReadOnlyList<CreateCheckoutSessionRequest> CheckoutRequests
    {
        get { lock (_checkoutRequests) return [.. _checkoutRequests]; }
    }

    public IReadOnlyList<(string StripeCustomerId, string ReturnUrl)> PortalRequests
    {
        get { lock (_portalRequests) return [.. _portalRequests]; }
    }

    public Task<CheckoutSessionResult> CreateCheckoutSessionAsync(CreateCheckoutSessionRequest request, CancellationToken ct)
    {
        lock (_checkoutRequests) _checkoutRequests.Add(request);
        return Task.FromResult(new CheckoutSessionResult($"https://checkout.stripe.com/fake/{Guid.NewGuid():N}"));
    }

    public Task<string> CreatePortalSessionAsync(string stripeCustomerId, string returnUrl, CancellationToken ct)
    {
        lock (_portalRequests) _portalRequests.Add((stripeCustomerId, returnUrl));
        return Task.FromResult($"https://billing.stripe.com/fake/{Guid.NewGuid():N}");
    }
}
