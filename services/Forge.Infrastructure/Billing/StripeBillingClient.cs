using Forge.Domain.Entities;
using Stripe;
using Stripe.Checkout;

namespace Forge.Infrastructure.Billing;

/// <summary>
/// The real Stripe.net-backed implementation. Checkout sessions carry the
/// workspace id in <c>Metadata</c>, not just as an in-memory correlation —
/// the webhook handler (the only place that ever writes a
/// <see cref="Subscription"/> row) reads it back from the
/// <c>checkout.session.completed</c> event, since the session response
/// this class returns to its caller is never itself proof of payment
/// (docs/SPEC.md Section 23.5, CLAUDE.md Section 1.1 guardrail 4).
/// </summary>
public sealed class StripeBillingClient(StripeClient stripeClient, string proPriceId, string studioPriceId) : IStripeBillingClient
{
    public async Task<CheckoutSessionResult> CreateCheckoutSessionAsync(CreateCheckoutSessionRequest request, CancellationToken ct)
    {
        var priceId = request.Plan switch
        {
            WorkspacePlan.Pro => proPriceId,
            WorkspacePlan.Studio => studioPriceId,
            _ => throw new ArgumentOutOfRangeException(nameof(request), request.Plan, "Plan must be 'pro' or 'studio'."),
        };

        var options = new SessionCreateOptions
        {
            Mode = "subscription",
            LineItems = [new SessionLineItemOptions { Price = priceId, Quantity = 1 }],
            SuccessUrl = request.SuccessUrl,
            CancelUrl = request.CancelUrl,
            Metadata = new Dictionary<string, string> { ["workspaceId"] = request.WorkspaceId.ToString() },
        };

        // A workspace that has billed before reuses its Stripe customer
        // (so payment methods and invoice history stay on one customer
        // record); a first-time checkout lets Stripe create the customer
        // from the email instead.
        if (request.ExistingStripeCustomerId is not null)
        {
            options.Customer = request.ExistingStripeCustomerId;
        }
        else
        {
            options.CustomerEmail = request.CustomerEmail;
        }

        var service = new SessionService(stripeClient);
        var session = await service.CreateAsync(options, cancellationToken: ct);
        return new CheckoutSessionResult(session.Url);
    }

    public async Task<string> CreatePortalSessionAsync(string stripeCustomerId, string returnUrl, CancellationToken ct)
    {
        var service = new Stripe.BillingPortal.SessionService(stripeClient);
        var session = await service.CreateAsync(new Stripe.BillingPortal.SessionCreateOptions
        {
            Customer = stripeCustomerId,
            ReturnUrl = returnUrl,
        }, cancellationToken: ct);
        return session.Url;
    }
}
