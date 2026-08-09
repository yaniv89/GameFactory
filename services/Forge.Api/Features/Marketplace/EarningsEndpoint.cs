using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Marketplace;

/// <summary>
/// docs/SPEC.md Section 13.2: <c>GET /api/v1/authors/me/earnings</c>.
/// Scoped to the calling user as an individual author, same pattern as
/// <see cref="ConnectAccountEndpoint"/>. <c>TotalEarnedCents</c> and
/// <c>PendingPayoutCents</c> are the same number this phase (M7 Phase
/// 4): nothing has actually been paid out yet — Stripe Connect
/// transfers happen automatically per-purchase via the destination
/// charge, but the Net-30/$50-minimum payout *schedule* docs/SPEC.md
/// Section 16.1 describes, and the ledger distinguishing "transferred to
/// Stripe" from "arrived in the author's bank account," is M7 Phase 5
/// scope — a stated gap, not a silently invented number.
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

    private static async Task<IResult> Handle(ICurrentUser currentUser, ForgeDbContext db, CancellationToken ct)
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

        return TypedResults.Ok(new AuthorEarningsResponse(totalCents, totalCents, currency, succeeded.Count));
    }
}
