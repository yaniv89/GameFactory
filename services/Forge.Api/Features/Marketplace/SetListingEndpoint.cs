using Forge.Api.Authorization;
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
///
/// Does not register its own route. Scoped package names contain their
/// own "/" (e.g. <c>@acme/farming</c>), so a plain <c>{name}</c> route
/// parameter can't carry one — every PUT under <c>/api/v1/packages/</c>
/// needs the same catch-all-and-manually-split shape
/// <see cref="Publishing.PublishVersionEndpoint"/> and
/// <see cref="Registry.PackageDetailAndVersionsEndpoint"/> already use for
/// exactly this reason, and ASP.NET Core rejects two <c>MapPut</c> calls
/// on the identical route template as an ambiguous match at request time
/// (caught by a real CI run: every PUT under this path started 500ing the
/// moment F1's <see cref="Registry.ReviewsEndpoint"/> tried to register
/// its own <c>PUT .../reviews</c> on the same template). So
/// <see cref="Registry.ReviewsEndpoint"/> owns the one PUT route for this
/// whole path prefix and dispatches to <see cref="Handle"/> here for the
/// <c>listing</c> trailing segment, the same way it dispatches to its own
/// review-upsert logic for the <c>reviews</c> segment.
/// </summary>
public static class SetListingEndpoint
{
    internal static async Task<IResult> Handle(
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
