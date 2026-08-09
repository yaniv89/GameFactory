using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Billing;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Forge.Api.Features.Marketplace;

/// <summary>
/// docs/SPEC.md Section 13.2: <c>POST /api/v1/checkout/sessions</c>.
/// Unlike the subscription checkout endpoint, the SPEC's own URL shape
/// for this one carries no <c>{workspaceId}</c> route segment — the
/// buying workspace is a body field instead, so the route-value-based
/// <c>WorkspaceRoleRequirement</c> policies this codebase otherwise uses
/// everywhere can't resolve it. Authorization is therefore done inline,
/// the same real-DB-lookup pattern <c>WorkspaceRoleHandler</c> and
/// <c>CollabHub.OnConnectedAsync</c> already use for exactly this
/// situation (a resource id that arrives somewhere a route-value policy
/// can't see): the request body's <c>workspaceId</c> is never trusted
/// directly (CLAUDE.md Section 1.1 guardrail 4) — only the current
/// user's own, server-resolved membership row on that workspace decides
/// whether the request proceeds, and a workspace that exists but the
/// caller isn't a member of 404s, never 403s (docs/SPEC.md Section 4.5).
/// Requires Editor-or-above, the same bar <c>project:write</c> uses —
/// installing a paid module is an editing action.
///
/// Only ever creates the Checkout Session and a <see cref="PurchaseStatus.Pending"/>
/// <see cref="Purchase"/> row — never a <see cref="License"/>. The
/// session response is not proof of payment; only the signature-verified
/// Stripe webhook ever grants a license (same posture
/// <see cref="Features.Billing.CheckoutSessionEndpoint"/> already
/// documents for subscriptions).
/// </summary>
public static class PurchaseCheckoutSessionEndpoint
{
    private static readonly IReadOnlyDictionary<string, int> RoleRank = new Dictionary<string, int>
    {
        [WorkspaceRole.Viewer] = 0,
        [WorkspaceRole.Editor] = 1,
        [WorkspaceRole.Admin] = 2,
        [WorkspaceRole.Owner] = 3,
    };

    public static IEndpointRouteBuilder MapPurchaseCheckoutSession(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/checkout/sessions", Handle)
            .RequireAuthorization(ForgeAuthorizationExtensions.BearerPolicy)
            .WithRateLimit("marketplace", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("CreatePurchaseCheckoutSession")
            .Produces<PurchaseCheckoutSessionResponse>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(
        CreatePurchaseCheckoutSessionRequest req,
        ForgeDbContext db,
        ICurrentUser currentUser,
        IStripeMarketplaceClient marketplace,
        IConfiguration configuration,
        CancellationToken ct)
    {
        var buyer = await db.DomainUsers.SingleOrDefaultAsync(u => u.Id == currentUser.UserId && u.DeletedAt == null, ct);
        if (buyer is null) return TypedResults.NotFound();

        var workspace = await db.Workspaces.SingleOrDefaultAsync(w => w.Id == req.WorkspaceId && w.DeletedAt == null, ct);
        if (workspace is null) return TypedResults.NotFound();

        var role = await db.WorkspaceMembers
            .Where(m => m.WorkspaceId == req.WorkspaceId && m.UserId == buyer.Id)
            .Select(m => m.Role)
            .SingleOrDefaultAsync(ct);
        if (role is null || !RoleRank.TryGetValue(role, out var rank) || rank < RoleRank[WorkspaceRole.Editor])
        {
            return TypedResults.NotFound(); // masks "exists but you can't buy for it" the same as "doesn't exist"
        }

        var package = await db.Packages.SingleOrDefaultAsync(p => p.Name == req.PackageName, ct);
        if (package is null) return TypedResults.NotFound();

        var listing = await db.Listings.SingleOrDefaultAsync(l => l.PackageId == package.Id, ct);
        if (listing is null || !listing.IsListed || listing.PricingModel == ListingPricingModel.Free)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["packageName"] = ["This package is not currently purchasable."],
            });
        }

        var author = await db.DomainUsers.SingleOrDefaultAsync(u => u.Id == package.AuthorUserId, ct);
        if (author?.StripeAccount is null)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["packageName"] = ["This package's author hasn't finished payout setup yet — it can't be purchased."],
            });
        }

        var alreadyLicensed = await db.Licenses.AnyAsync(
            l => l.PackageId == package.Id && l.WorkspaceId == req.WorkspaceId && l.RevokedAt == null, ct);
        if (alreadyLicensed)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["packageName"] = ["This workspace already owns a license for this package."],
            });
        }

        var authorShareCents = (int)((long)listing.PriceCents * listing.RevenueShareBps / 10_000);
        var applicationFeeCents = listing.PriceCents - authorShareCents;

        var editorBaseUrl = configuration["Editor:BaseUrl"]
            ?? throw new InvalidOperationException("Missing Editor:BaseUrl configuration.");

        var result = await marketplace.CreatePurchaseCheckoutSessionAsync(
            new Infrastructure.Billing.CreatePurchaseCheckoutSessionRequest(
                package.DisplayName,
                listing.PriceCents,
                listing.Currency,
                author.StripeAccount,
                applicationFeeCents,
                buyer.Email,
                req.WorkspaceId,
                package.Id,
                SuccessUrl: $"{editorBaseUrl}/marketplace?checkout=success",
                CancelUrl: $"{editorBaseUrl}/marketplace?checkout=canceled"),
            ct);

        db.Purchases.Add(new Purchase
        {
            WorkspaceId = req.WorkspaceId,
            BuyerUserId = buyer.Id,
            PackageId = package.Id,
            AmountCents = listing.PriceCents,
            Currency = listing.Currency,
            AuthorShareCents = authorShareCents,
            StripePaymentIntent = result.StripePaymentIntentId,
            Status = PurchaseStatus.Pending,
            CreatedAt = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync(ct);

        return TypedResults.Ok(new PurchaseCheckoutSessionResponse(result.SessionUrl));
    }
}
