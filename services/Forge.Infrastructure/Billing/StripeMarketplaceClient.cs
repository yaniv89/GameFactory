using Stripe;
using Stripe.Checkout;

namespace Forge.Infrastructure.Billing;

/// <summary>
/// The real Stripe.net-backed implementation. ⚠ The exact Stripe.net
/// nested-options class names used below (<c>SessionLineItemOptions</c>,
/// <c>SessionLineItemPriceDataOptions</c>,
/// <c>SessionLineItemPriceDataProductDataOptions</c>,
/// <c>SessionPaymentIntentDataOptions</c>,
/// <c>SessionPaymentIntentDataTransferDataOptions</c>,
/// <c>AccountCapabilitiesOptions</c>/<c>AccountCapabilitiesTransfersOptions</c>)
/// could not be confirmed against the real Stripe.net 47.4.0 source in
/// this sandbox — every source/docs host that would confirm them
/// (github.com raw paths that 404'd on every guessed layout,
/// docs.stripe.com, fuget.org, jsdelivr, the GitHub API) is blocked by
/// this environment's network egress proxy. This is the same
/// no-local-verification situation every other file in this PR is
/// already in (no .NET SDK exists in this sandbox at all), just with an
/// extra, unsuccessful attempt at independent verification on top. If
/// CI's real build disagrees with any of these names, that is the
/// actual verification this class has been waiting for — fix forward
/// from the real compiler error, the same way two earlier fixes landed
/// on this PR from real CI failures.
/// </summary>
public sealed class StripeMarketplaceClient(StripeClient stripeClient) : IStripeMarketplaceClient
{
    public async Task<ConnectAccountLinkResult> CreateConnectAccountLinkAsync(CreateConnectAccountLinkRequest request, CancellationToken ct)
    {
        string accountId;
        if (request.ExistingStripeAccountId is not null)
        {
            accountId = request.ExistingStripeAccountId;
        }
        else
        {
            var accountService = new AccountService(stripeClient);
            var account = await accountService.CreateAsync(new AccountCreateOptions
            {
                Type = "express",
                Email = request.Email,
                Capabilities = new AccountCapabilitiesOptions
                {
                    Transfers = new AccountCapabilitiesTransfersOptions { Requested = true },
                },
            }, cancellationToken: ct);
            accountId = account.Id;
        }

        var linkService = new AccountLinkService(stripeClient);
        var link = await linkService.CreateAsync(new AccountLinkCreateOptions
        {
            Account = accountId,
            Type = "account_onboarding",
            RefreshUrl = request.RefreshUrl,
            ReturnUrl = request.ReturnUrl,
        }, cancellationToken: ct);

        return new ConnectAccountLinkResult(accountId, link.Url);
    }

    public async Task<PurchaseCheckoutSessionResult> CreatePurchaseCheckoutSessionAsync(CreatePurchaseCheckoutSessionRequest request, CancellationToken ct)
    {
        var options = new SessionCreateOptions
        {
            Mode = "payment",
            LineItems =
            [
                new SessionLineItemOptions
                {
                    Quantity = 1,
                    PriceData = new SessionLineItemPriceDataOptions
                    {
                        Currency = request.Currency,
                        UnitAmount = request.AmountCents,
                        ProductData = new SessionLineItemPriceDataProductDataOptions { Name = request.PackageDisplayName },
                    },
                },
            ],
            CustomerEmail = request.BuyerEmail,
            SuccessUrl = request.SuccessUrl,
            CancelUrl = request.CancelUrl,
            PaymentIntentData = new SessionPaymentIntentDataOptions
            {
                ApplicationFeeAmount = request.ApplicationFeeCents,
                TransferData = new SessionPaymentIntentDataTransferDataOptions
                {
                    Destination = request.ConnectedStripeAccountId,
                },
            },
            // The webhook (the only place a Purchase/License is ever
            // written — this session response is not proof of payment,
            // CLAUDE.md Section 1.1 guardrail 4) reads these back from
            // the checkout.session.completed event, the same correlation
            // pattern CheckoutSessionEndpoint/StripeWebhookEndpoint
            // already use for subscription checkouts.
            Metadata = new Dictionary<string, string>
            {
                ["workspaceId"] = request.WorkspaceId.ToString(),
                ["packageId"] = request.PackageId.ToString(),
            },
        };

        var service = new SessionService(stripeClient);
        var session = await service.CreateAsync(options, cancellationToken: ct);
        return new PurchaseCheckoutSessionResult(session.Url, session.PaymentIntentId);
    }
}
