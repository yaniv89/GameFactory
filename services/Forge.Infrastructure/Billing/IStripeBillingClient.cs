namespace Forge.Infrastructure.Billing;

public sealed record CreateCheckoutSessionRequest(
    string Plan,
    string? ExistingStripeCustomerId,
    string CustomerEmail,
    Guid WorkspaceId,
    string SuccessUrl,
    string CancelUrl);

public sealed record CheckoutSessionResult(string SessionUrl);

/// <summary>
/// The two Stripe operations the billing endpoints need, behind an
/// interface so the endpoints' own logic (authorization, validation,
/// plan-to-price mapping, 404-when-no-subscription-yet) is testable
/// without a real Stripe test-mode API key — which this environment
/// doesn't have. <see cref="StripeBillingClient"/> is the real
/// implementation; Forge.Tests has a hand-written fake (the same pattern
/// <c>CapturingEmailSender</c> uses for <c>IEmailSender</c>) rather than a
/// mocking framework, matching how the rest of this codebase tests
/// against real dependencies (Postgres, Redis) instead of mocks wherever
/// a real one is actually available — Stripe is the one dependency here
/// where it isn't.
/// </summary>
public interface IStripeBillingClient
{
    Task<CheckoutSessionResult> CreateCheckoutSessionAsync(CreateCheckoutSessionRequest request, CancellationToken ct);

    Task<string> CreatePortalSessionAsync(string stripeCustomerId, string returnUrl, CancellationToken ct);
}
