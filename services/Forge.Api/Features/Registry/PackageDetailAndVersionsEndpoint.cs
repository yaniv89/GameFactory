using Forge.Api.RateLimiting;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Registry;

/// <summary>
/// docs/SPEC.md Section 13.2's three "under a package name" reads:
/// <c>GET /api/v1/packages/{name}</c>, <c>GET /api/v1/packages/{name}/versions</c>,
/// and <c>GET /api/v1/packages/{name}/versions/{version}</c> — mapped to
/// one physical route and dispatched here, not three separate route
/// templates.
///
/// Why: every package name in this registry that appears anywhere in
/// docs/SPEC.md is scoped (<c>@acme/farming</c>, <c>@forge/dialogue</c>)
/// — the name itself contains a literal <c>/</c>. ASP.NET Core route
/// templates can only capture that with a catch-all segment
/// (<c>{*name}</c>), and a catch-all is only legal as the very last
/// segment of a template — <c>{*name}/versions</c> fails at startup
/// ("a catch-all parameter can only appear as the last segment"). So
/// there is no way to express "the name, then optionally /versions, then
/// optionally /{version}" as three separate ASP.NET Core route
/// templates once the name itself may contain slashes. One catch-all
/// route plus explicit dispatch on the trailing segments is the actual
/// fix, not a workaround — SPEC's three-line endpoint list is a surface
/// description, not literally three independent route templates it
/// requires this framework to implement as such.
/// </summary>
public static class PackageDetailAndVersionsEndpoint
{
    private const int DefaultLimit = 20;
    private const int MaxLimit = 100;

    public static IEndpointRouteBuilder MapPackageDetailAndVersions(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/packages/{*path}", Handle)
            .WithRateLimit("registry", RateLimitKeyStrategy.IpAddress, RateLimitPolicies.Registry)
            .WithName("GetPackageOrVersions")
            .Produces<PackageDetailResponse>()
            .Produces<PackageVersionListResponse>()
            .Produces<PackageVersionDetailResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(
        string path, string? cursor, int? limit, ForgeDbContext db, CancellationToken ct)
    {
        var segments = path.Split('/', StringSplitOptions.RemoveEmptyEntries);

        // A scoped name is exactly ["@scope", "name-part"]; an unscoped
        // one is exactly ["name-part"]. "versions"/"reviews" (F1)/"issues"
        // (support-responsiveness), if present, is the segment immediately
        // after the name ends — a real name never contains any of the
        // three, so whichever index is >= 0 (at most one is) is the real
        // split point.
        var versionsIndex = Array.IndexOf(segments, "versions");
        var reviewsIndex = Array.IndexOf(segments, "reviews");
        var issuesIndex = Array.IndexOf(segments, "issues");
        var specialIndex = versionsIndex >= 0 ? versionsIndex : reviewsIndex >= 0 ? reviewsIndex : issuesIndex;
        var nameSegmentCount = specialIndex < 0 ? segments.Length : specialIndex;
        if (nameSegmentCount is not (1 or 2))
        {
            return TypedResults.NotFound();
        }
        var name = string.Join('/', segments[..nameSegmentCount]);

        if (reviewsIndex >= 0)
        {
            var reviewsTrailing = segments[(reviewsIndex + 1)..];
            // No per-review-id lookup in v1 — only the list.
            return reviewsTrailing.Length == 0 ? await ListReviewsAsync(name, cursor, limit, db, ct) : TypedResults.NotFound();
        }

        if (issuesIndex >= 0)
        {
            var issuesTrailing = segments[(issuesIndex + 1)..];
            // No per-issue-id lookup (with its own reply thread) in v1 —
            // only the list, same v1 scope boundary ListReviewsAsync's own
            // comment states for reviews.
            return issuesTrailing.Length == 0 ? await ListIssuesAsync(name, cursor, limit, db, ct) : TypedResults.NotFound();
        }

        if (versionsIndex < 0)
        {
            return await GetPackageAsync(name, db, ct);
        }

        var trailing = segments[(versionsIndex + 1)..];
        return trailing.Length switch
        {
            0 => await ListVersionsAsync(name, cursor, limit, db, ct),
            1 => await GetVersionAsync(name, trailing[0], db, ct),
            _ => TypedResults.NotFound(),
        };
    }

    private static async Task<IResult> GetPackageAsync(string name, ForgeDbContext db, CancellationToken ct)
    {
        // No navigation property from Package to its own Listing (they're
        // linked only by the shared PackageId primary key, per Listing's
        // own doc comment) — a correlated subquery against db.Listings is
        // the real join, and it's an indexed primary-key lookup, not a
        // scan.
        var package = await db.Packages
            .Where(p => p.Name == name)
            .Select(p => new PackageDetailResponse(
                p.Id, p.Name, p.Kind, p.AuthorUserId, p.DisplayName, p.Summary,
                p.ReadmeMarkdown, p.HomepageUrl, p.LicenseSpdx, p.IsDeprecated, p.CreatedAt,
                p.Reviews.Count == 0 ? null : p.Reviews.Average(r => (double?)r.Rating),
                p.Reviews.Count,
                db.Listings.Where(l => l.PackageId == p.Id).Select(l => l.PricingModel).Single(),
                db.Listings.Where(l => l.PackageId == p.Id).Select(l => l.PriceCents).Single()))
            .SingleOrDefaultAsync(ct);

        return package is null ? TypedResults.NotFound() : TypedResults.Ok(package);
    }

    /// <summary>docs/SPEC.md Section 16.2 (F1): <c>GET /api/v1/packages/{name}/reviews</c>, newest first — anonymous, the same public-storefront posture as every other read in this class. <see cref="ReviewListResponse.AverageRating"/>/<see cref="ReviewListResponse.ReviewCount"/> are the raw (non-Bayesian-shrunk) numbers — <see cref="Marketplace.PackageRankingCalculator.CalculateBayesianRating"/> is what <c>ListPackagesEndpoint</c> uses for ranking, deliberately not what a person reads on a package's own page, where the honest raw average is the more meaningful number to show.</summary>
    private static async Task<IResult> ListReviewsAsync(string name, string? cursor, int? limit, ForgeDbContext db, CancellationToken ct)
    {
        var packageId = await db.Packages.Where(p => p.Name == name).Select(p => (Guid?)p.Id).SingleOrDefaultAsync(ct);
        if (packageId is null) return TypedResults.NotFound();

        var pageSize = Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit);

        var query = db.Reviews.Where(r => r.PackageId == packageId);
        if (cursor is not null && Guid.TryParse(cursor, out var afterId))
        {
            var afterCreatedAt = await db.Reviews.Where(r => r.Id == afterId).Select(r => (DateTimeOffset?)r.CreatedAt).SingleOrDefaultAsync(ct);
            if (afterCreatedAt is { } after) query = query.Where(r => r.CreatedAt < after);
        }

        var page = await query
            .OrderByDescending(r => r.CreatedAt)
            .Take(pageSize + 1)
            .Select(r => new ReviewResponse(r.Id, r.UserId, r.Rating, r.Body, r.CreatedAt, r.UpdatedAt))
            .ToListAsync(ct);

        var hasMore = page.Count > pageSize;
        var reviews = hasMore ? page[..pageSize] : page;
        var nextCursor = hasMore ? reviews[^1].Id.ToString() : null;

        var allForPackage = db.Reviews.Where(r => r.PackageId == packageId);
        var reviewCount = await allForPackage.CountAsync(ct);
        double? averageRating = reviewCount == 0 ? null : await allForPackage.AverageAsync(r => (double)r.Rating, ct);

        return TypedResults.Ok(new ReviewListResponse(reviews, nextCursor, averageRating, reviewCount));
    }

    /// <summary>The minimal issue tracker's own read (support-responsiveness signal): <c>GET /api/v1/packages/{name}/issues</c>, newest first — anonymous, the same public-storefront posture as every other read in this class. <see cref="IssueResponse.FirstReplyAt"/> is computed per issue the same way <c>ListPackagesEndpoint</c>'s own responsiveness-signal query computes it, so a person browsing issues sees which ones are already answered without a separate reply-thread endpoint existing yet.</summary>
    private static async Task<IResult> ListIssuesAsync(string name, string? cursor, int? limit, ForgeDbContext db, CancellationToken ct)
    {
        var packageId = await db.Packages.Where(p => p.Name == name).Select(p => (Guid?)p.Id).SingleOrDefaultAsync(ct);
        if (packageId is null) return TypedResults.NotFound();

        var pageSize = Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit);

        var query = db.PackageIssues.Where(i => i.PackageId == packageId);
        if (cursor is not null && Guid.TryParse(cursor, out var afterId))
        {
            var afterCreatedAt = await db.PackageIssues.Where(i => i.Id == afterId).Select(i => (DateTimeOffset?)i.CreatedAt).SingleOrDefaultAsync(ct);
            if (afterCreatedAt is { } after) query = query.Where(i => i.CreatedAt < after);
        }

        var page = await query
            .OrderByDescending(i => i.CreatedAt)
            .Take(pageSize + 1)
            .Select(i => new IssueResponse(
                i.Id, i.ReporterUserId, i.Title, i.Body, i.CreatedAt,
                i.Replies.OrderBy(r => r.CreatedAt).Select(r => (DateTimeOffset?)r.CreatedAt).FirstOrDefault()))
            .ToListAsync(ct);

        var hasMore = page.Count > pageSize;
        var issues = hasMore ? page[..pageSize] : page;
        var nextCursor = hasMore ? issues[^1].Id.ToString() : null;

        return TypedResults.Ok(new IssueListResponse(issues, nextCursor));
    }

    private static async Task<IResult> ListVersionsAsync(string name, string? cursor, int? limit, ForgeDbContext db, CancellationToken ct)
    {
        var packageId = await db.Packages.Where(p => p.Name == name).Select(p => (Guid?)p.Id).SingleOrDefaultAsync(ct);
        if (packageId is null) return TypedResults.NotFound();

        var pageSize = Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit);

        var query = db.PackageVersions.Where(v => v.PackageId == packageId);
        if (cursor is not null && Guid.TryParse(cursor, out var afterId))
        {
            var afterPublishedAt = await db.PackageVersions.Where(v => v.Id == afterId).Select(v => (DateTimeOffset?)v.PublishedAt).SingleOrDefaultAsync(ct);
            if (afterPublishedAt is { } after) query = query.Where(v => v.PublishedAt < after);
        }

        var page = await query
            .OrderByDescending(v => v.PublishedAt)
            .Take(pageSize + 1)
            .Select(v => new PackageVersionSummaryResponse(v.Id, v.Version, v.EngineRange, v.ScanStatus, v.SizeBytes, v.PublishedAt, v.YankedAt))
            .ToListAsync(ct);

        var hasMore = page.Count > pageSize;
        var versions = hasMore ? page[..pageSize] : page;
        var nextCursor = hasMore ? versions[^1].Id.ToString() : null;

        return TypedResults.Ok(new PackageVersionListResponse(versions, nextCursor));
    }

    private static async Task<IResult> GetVersionAsync(string name, string version, ForgeDbContext db, CancellationToken ct)
    {
        // Convert.ToHexString isn't translatable to SQL, so the raw bytes
        // are selected and materialized first — converting them inside
        // the .Select() below would fail at query-translation time, not
        // just be slow.
        var row = await db.PackageVersions
            .Where(v => v.Package!.Name == name && v.Version == version)
            .Select(v => new
            {
                v.Id, v.Version, v.EngineRange, v.Manifest, v.BundleUrl, v.BundleSha256,
                v.SizeBytes, v.ScanStatus, v.PublishedAt, v.YankedAt, v.YankReason,
            })
            .SingleOrDefaultAsync(ct);

        if (row is null) return TypedResults.NotFound();

        return TypedResults.Ok(new PackageVersionDetailResponse(
            row.Id, row.Version, row.EngineRange, row.Manifest, row.BundleUrl,
            Convert.ToHexString(row.BundleSha256), row.SizeBytes, row.ScanStatus,
            row.PublishedAt, row.YankedAt, row.YankReason));
    }
}
