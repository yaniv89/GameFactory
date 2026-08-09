using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Billing;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Marketplace;

/// <summary>
/// docs/SPEC.md Section 13.2: <c>GET /api/v1/authors/me/earnings</c>.
/// Scoped to the calling user as an individual author, same pattern as
/// <see cref="ConnectAccountEndpoint"/>. <c>PendingPayoutCents</c> (added
/// M7 Phase 5) is <c>TotalEarnedCents</c> minus the sum of this author's
/// connected account's own <c>paid</c>-status Stripe payouts — resolving
/// M7 Phase 4's stated gap (it used to just equal TotalEarnedCents,
/// since nothing distinguished "transferred to Stripe" from "arrived in
/// the author's bank account" yet) by querying Stripe's own payout
/// ledger live rather than duplicating it in this database, the same
/// no-second-source-of-truth reasoning <see cref="IStripeMarketplaceClient.ListPayoutsAsync"/>
/// documents. An author with no linked Stripe account can't have been
/// paid out anything, so the query is skipped entirely for them —
/// PendingPayoutCents just equals TotalEarnedCents, same as before.
/// </summary>
public static class EarningsEndpoint
{
    public static IEndpointRouteBuilder MapEarnings(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/authors/me/earnings", Handle)
            .RequireAuthorization(ForgeAuthorizationExtensions.BearerPolicy)
            .WithRateLimit("marketplace", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("GetAuthorEarnings")
            .Produces<AuthorEarningsResponse>();
        return app;
    }

    private static async Task<IResult> Handle(ICurrentUser currentUser, ForgeDbContext db, IStripeMarketplaceClient marketplace, CancellationToken ct)
    {
        var succeeded = await db.Purchases
            .Where(p => p.Package!.AuthorUserId == currentUser.UserId && p.Status == PurchaseStatus.Succeeded)
            .Select(p => new { p.AuthorShareCents, p.Currency })
            .ToListAsync(ct);

        var totalCents = succeeded.Sum(p => p.AuthorShareCents);
        // A single, real currency isn't guaranteed once an author sells
        // in more than one — every purchase created so far always uses
        // the listing's own currency, itself always "USD" today (no UI
        // to set another one yet), so this is accurate in practice; a
        // multi-currency ledger is a real gap for whenever that changes.
        var currency = succeeded.Count > 0 ? succeeded[0].Currency : "USD";

        var stripeAccount = await db.DomainUsers
            .Where(u => u.Id == currentUser.UserId)
            .Select(u => u.StripeAccount)
            .SingleOrDefaultAsync(ct);

        var pendingCents = totalCents;
        if (stripeAccount is not null)
        {
            var payouts = await marketplace.ListPayoutsAsync(stripeAccount, ct);
            var paidOutCents = payouts.Where(p => p.Status == "paid").Sum(p => p.AmountCents);
            pendingCents = Math.Max(0, totalCents - paidOutCents);
        }

        return TypedResults.Ok(new AuthorEarningsResponse(totalCents, pendingCents, currency, succeeded.Count));
    }
}
