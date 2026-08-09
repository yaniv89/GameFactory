using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Infrastructure.Billing;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Marketplace;

/// <summary>
/// M7 Phase 5: <c>GET /api/v1/authors/me/payouts</c> — not one of
/// docs/SPEC.md Section 13.2's explicitly listed endpoints, same
/// necessary-addition posture as <see cref="ConnectAccountEndpoint"/>:
/// <see cref="EarningsEndpoint"/> summarizes what's owed and what's
/// still pending, but an author asking "did the Tuesday payout actually
/// land" needs the real Stripe payout history, not just a total. Queried
/// live from Stripe (<see cref="IStripeMarketplaceClient.ListPayoutsAsync"/>),
/// never mirrored into this database. An author with no linked Stripe
/// account has no connected-account context to query payouts in, so
/// this returns an empty list rather than erroring — "no payouts yet"
/// and "can't have any payouts" read the same to this endpoint.
/// </summary>
public static class PayoutsEndpoint
{
    public static IEndpointRouteBuilder MapPayouts(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/authors/me/payouts", Handle)
            .RequireAuthorization(ForgeAuthorizationExtensions.BearerPolicy)
            .WithRateLimit("marketplace", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("GetAuthorPayouts")
            .Produces<IReadOnlyList<PayoutHistoryEntryResponse>>();
        return app;
    }

    private static async Task<IResult> Handle(ICurrentUser currentUser, ForgeDbContext db, IStripeMarketplaceClient marketplace, CancellationToken ct)
    {
        var stripeAccount = await db.DomainUsers
            .Where(u => u.Id == currentUser.UserId)
            .Select(u => u.StripeAccount)
            .SingleOrDefaultAsync(ct);

        if (stripeAccount is null)
        {
            return TypedResults.Ok(Array.Empty<PayoutHistoryEntryResponse>());
        }

        var payouts = await marketplace.ListPayoutsAsync(stripeAccount, ct);
        var response = payouts
            .Select(p => new PayoutHistoryEntryResponse(p.StripePayoutId, p.AmountCents, p.Currency, p.Status, p.ArrivalDate))
            .ToList();

        return TypedResults.Ok(response);
    }
}
