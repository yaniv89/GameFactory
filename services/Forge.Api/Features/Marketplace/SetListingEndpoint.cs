using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Marketplace;

/// <summary>
/// <c>PUT /api/v1/packages/{name}/listing</c> — also not one of
/// docs/SPEC.md Section 13.2's explicitly listed endpoints (same
/// necessary-addition posture as <see cref="ConnectAccountEndpoint"/>):
/// <see cref="PublishVersionEndpoint"/> seeds every new package's
/// <see cref="Listing"/> as free (docs/SPEC.md Section 16.1's
/// "unlimited free packages"), and nothing in the spec's own endpoint
/// list ever changes it — but an author has to be able to set a real
/// price for <c>one_time</c>/<c>subscription</c> to mean anything.
/// Cross-tenant authorization here is "only this package's own author,"
/// not a workspace role — resolved from <see cref="Package.AuthorUserId"/>
/// against the token's own subject, never a client-supplied claim
/// (CLAUDE.md Section 1.1 guardrail 4), and a package that exists but
/// belongs to someone else 404s rather than 403s, the same
/// cross-tenant-masking posture every other endpoint in this codebase
/// already uses (docs/SPEC.md Section 4.5).
/// </summary>
public static class SetListingEndpoint
{
    public static IEndpointRouteBuilder MapSetListing(this IEndpointRouteBuilder app)
    {
        // Scoped package names contain their own "/" (e.g. @acme/farming),
        // so a plain {name} route parameter can't carry one — same
        // catch-all-and-manually-split shape PublishVersionEndpoint and
        // PackageDetailAndVersionsEndpoint already use for exactly this
        // reason. Caught by a real CI run: a scoped-named package's PUT
        // request came back 405 MethodNotAllowed, not 200/400, because
        // {name} only ever captured the segment up to the first "/".
        app.MapPut("/api/v1/packages/{*path}", Handle)
            .RequireAuthorization(ForgeAuthorizationExtensions.BearerPolicy)
            .WithRateLimit("marketplace", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("SetListing")
            .Produces<ListingResponse>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(
        string path,
        SetListingRequest req,
        ForgeDbContext db,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length is not (2 or 3) || segments[^1] != "listing")
        {
            return TypedResults.NotFound();
        }
        var name = string.Join('/', segments[..^1]);

        if (!ListingPricingModel.All.Contains(req.PricingModel))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["pricingModel"] = [$"Must be one of: {string.Join(", ", ListingPricingModel.All)}."],
            });
        }

        var isFree = req.PricingModel == ListingPricingModel.Free;
        if (isFree != (req.PriceCents == 0))
        {
            // Mirrors docs/SPEC.md Section 6.2's own ck_price check
            // constraint in application code too, so a violation surfaces
            // as a real validation error instead of a 500 from the
            // database rejecting the write.
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["priceCents"] = isFree ? ["Must be 0 for a free listing."] : ["Must be greater than 0 for a paid listing."],
            });
        }

        var package = await db.Packages.SingleOrDefaultAsync(p => p.Name == name, ct);
        if (package is null || package.AuthorUserId != currentUser.UserId) return TypedResults.NotFound();

        var listing = await db.Listings.SingleOrDefaultAsync(l => l.PackageId == package.Id, ct);
        if (listing is null) return TypedResults.NotFound();

        listing.PricingModel = req.PricingModel;
        listing.PriceCents = req.PriceCents;
        await db.SaveChangesAsync(ct);

        return TypedResults.Ok(new ListingResponse(package.Name, listing.PricingModel, listing.PriceCents, listing.Currency, listing.RevenueShareBps, listing.IsListed));
    }
}
