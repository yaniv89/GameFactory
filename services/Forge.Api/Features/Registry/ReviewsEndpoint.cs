using Forge.Api.Authorization;
using Forge.Api.Features.Marketplace;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Registry;

/// <summary>
/// docs/SPEC.md Section 16.2's ratings/reviews subsystem (F1):
/// <c>PUT /api/v1/packages/{name}/reviews</c> (create-or-update the
/// caller's own review) and <c>DELETE /api/v1/packages/{name}/reviews</c>
/// (remove it). Mapped onto the same catch-all-path-plus-trailing-segment
/// dispatch <see cref="Publishing.PublishVersionEndpoint"/> already uses
/// for the identical reason — a scoped package name contains a literal
/// <c>/</c>, so <c>{*path}</c> plus checking the last segment is the only
/// way to express "the name, then a fixed trailing route." The read side
/// (<c>GET .../reviews</c>) lives in <see cref="PackageDetailAndVersionsEndpoint"/>
/// instead, since that class already owns the one <c>GET</c> catch-all
/// for this URL shape and a second <c>MapGet</c> on the same template
/// would be an ambiguous-route startup failure, not a second route.
///
/// This class also owns the one <c>PUT</c> registration on this template
/// for the same reason — a second <c>MapPut</c> from
/// <see cref="SetListingEndpoint"/> is an ambiguous match at request time
/// (a real 500, caught by a real CI run, not a startup-time error the way
/// two identical <c>MapGet</c>s are), so <see cref="DispatchPut"/> reads
/// the trailing segment first and routes to whichever body type/handler
/// actually owns it — <see cref="SetListingEndpoint.Handle"/> for
/// <c>listing</c>, <see cref="HandleUpsert"/> for <c>reviews</c> — instead
/// of each feature registering its own competing route.
/// </summary>
public static class ReviewsEndpoint
{
    public static IEndpointRouteBuilder MapReviews(this IEndpointRouteBuilder app)
    {
        app.MapPut("/api/v1/packages/{*path}", DispatchPut)
            .RequireAuthorization(ForgeAuthorizationExtensions.BearerPolicy)
            .WithRateLimit("api", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("PutPackageSubresource")
            .Produces<ReviewResponse>(StatusCodes.Status200OK)
            .Produces<ListingResponse>(StatusCodes.Status200OK)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status403Forbidden)
            .ProducesProblem(StatusCodes.Status404NotFound);

        app.MapDelete("/api/v1/packages/{*path}", HandleDelete)
            .RequireAuthorization(ForgeAuthorizationExtensions.BearerPolicy)
            .WithRateLimit("api", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("DeleteReview")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound);

        return app;
    }

    /// <summary>
    /// The trailing segment alone (no body read needed yet) is enough to
    /// pick a destination — <see cref="SetListingEndpoint.Handle"/> and
    /// <see cref="HandleUpsert"/> each re-derive the package name from the
    /// full <paramref name="path"/> themselves, the same way they always
    /// did back when each had its own route.
    /// </summary>
    private static async Task<IResult> DispatchPut(string path, HttpContext context, ForgeDbContext db, ICurrentUser currentUser, CancellationToken ct)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0) return TypedResults.NotFound();

        return segments[^1] switch
        {
            "listing" => await SetListingEndpoint.Handle(
                path, await context.Request.ReadFromJsonAsync<SetListingRequest>(ct) ?? new SetListingRequest("", 0), db, currentUser, ct),
            "reviews" => await HandleUpsert(
                path, await context.Request.ReadFromJsonAsync<UpsertReviewRequest>(ct) ?? new UpsertReviewRequest(0, null), db, currentUser, ct),
            _ => TypedResults.NotFound(),
        };
    }

    private static async Task<IResult> HandleUpsert(string path, UpsertReviewRequest req, ForgeDbContext db, ICurrentUser currentUser, CancellationToken ct)
    {
        var name = ExtractPackageName(path, "reviews");
        if (name is null) return TypedResults.NotFound();

        if (req.Rating is < 1 or > 5)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["rating"] = ["Must be between 1 and 5."] });
        }

        var package = await db.Packages.Where(p => p.Name == name).Select(p => new { p.Id }).SingleOrDefaultAsync(ct);
        if (package is null) return TypedResults.NotFound();

        // Verified-purchase gating for paid listings only: a free listing
        // has no Purchase/License trail at all (nothing in this platform
        // tracks a free install, docs/SPEC.md Section 16.2's own
        // ActiveInstalls30d doc comment says so), so requiring one here
        // would make every free package's reviews impossible to write,
        // not more trustworthy — this is a real, stated boundary of the
        // check, not a gap.
        var pricingModel = await db.Listings.Where(l => l.PackageId == package.Id).Select(l => l.PricingModel).SingleOrDefaultAsync(ct);
        if (pricingModel is not null and not ListingPricingModel.Free)
        {
            var hasLicense = await db.Licenses
                .Where(l => l.PackageId == package.Id && l.RevokedAt == null)
                .Join(db.WorkspaceMembers.Where(m => m.UserId == currentUser.UserId), l => l.WorkspaceId, m => m.WorkspaceId, (l, m) => l)
                .AnyAsync(ct);
            if (!hasLicense)
            {
                return TypedResults.Problem(
                    title: "Purchase required",
                    detail: "Only a workspace that holds a license for this package can review it.",
                    statusCode: StatusCodes.Status403Forbidden);
            }
        }

        var existing = await db.Reviews.SingleOrDefaultAsync(r => r.PackageId == package.Id && r.UserId == currentUser.UserId, ct);
        var now = DateTimeOffset.UtcNow;
        if (existing is not null)
        {
            existing.Rating = req.Rating;
            existing.Body = req.Body;
            existing.UpdatedAt = now;
            await db.SaveChangesAsync(ct);
            return TypedResults.Ok(new ReviewResponse(existing.Id, existing.UserId, existing.Rating, existing.Body, existing.CreatedAt, existing.UpdatedAt));
        }

        var review = new Review
        {
            Id = Guid.NewGuid(),
            PackageId = package.Id,
            UserId = currentUser.UserId,
            Rating = req.Rating,
            Body = req.Body,
            CreatedAt = now,
        };
        db.Reviews.Add(review);
        await db.SaveChangesAsync(ct);
        return TypedResults.Ok(new ReviewResponse(review.Id, review.UserId, review.Rating, review.Body, review.CreatedAt, review.UpdatedAt));
    }

    private static async Task<IResult> HandleDelete(string path, ForgeDbContext db, ICurrentUser currentUser, CancellationToken ct)
    {
        var name = ExtractPackageName(path, "reviews");
        if (name is null) return TypedResults.NotFound();

        var deleted = await db.Reviews
            .Where(r => r.Package!.Name == name && r.UserId == currentUser.UserId)
            .ExecuteDeleteAsync(ct);

        return deleted > 0 ? TypedResults.NoContent() : TypedResults.NotFound();
    }

    /// <summary>Same segment-splitting shape <see cref="Publishing.PublishVersionEndpoint"/> uses — a scoped name is exactly 2 segments, an unscoped one exactly 1, and the path must end in <paramref name="trailingSegment"/> for this handler to be the right one at all.</summary>
    private static string? ExtractPackageName(string path, string trailingSegment)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length is not (2 or 3) || segments[^1] != trailingSegment) return null;
        return string.Join('/', segments[..^1]);
    }
}
