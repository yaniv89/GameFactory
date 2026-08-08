using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Registry;

/// <summary>
/// docs/SPEC.md Section 13.2: <c>GET /api/v1/packages?q=&amp;kind=&amp;cursor=</c>.
/// Anonymous — browsing the catalog needs no more authentication than
/// npm's own registry API does (docs/SPEC.md Section 16's marketplace is
/// a public storefront, not a workspace-scoped resource).
///
/// Cursor-paginated on <c>name</c> (globally unique, so it's a complete
/// order on its own — no composite-key cursor needed): ascending
/// alphabetical, which is a real, useful default ordering, not a stand-in
/// for the SPEC surface's <c>sort=</c> parameter — that parameter isn't
/// implemented yet (M6's later phases are the actual driver for
/// relevance/installs/rating sorting, none of which exist until the
/// marketplace signals in Section 16.2 do), so this endpoint doesn't
/// accept it rather than pretending to.
/// </summary>
public static class ListPackagesEndpoint
{
    private const int DefaultLimit = 20;
    private const int MaxLimit = 100;

    public static IEndpointRouteBuilder MapListPackages(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/packages", Handle)
            .WithRateLimit("registry", RateLimitKeyStrategy.IpAddress, RateLimitPolicies.Registry)
            .WithName("ListPackages")
            .Produces<PackageListResponse>();
        return app;
    }

    private static async Task<IResult> Handle(
        string? q, string? kind, string? cursor, int? limit, ForgeDbContext db, CancellationToken ct)
    {
        if (kind is not null && !PackageKind.All.Contains(kind))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["kind"] = [$"Must be one of: {string.Join(", ", PackageKind.All)}."],
            });
        }

        var pageSize = Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit);

        var query = db.Packages.AsQueryable();
        if (kind is not null) query = query.Where(p => p.Kind == kind);
        if (!string.IsNullOrWhiteSpace(q))
        {
            var pattern = $"%{q}%";
            query = query.Where(p => EF.Functions.ILike(p.DisplayName, pattern) || EF.Functions.ILike(p.Summary, pattern));
        }
        if (cursor is not null) query = query.Where(p => string.Compare(p.Name, cursor) > 0);

        var page = await query
            .OrderBy(p => p.Name)
            .Take(pageSize + 1)
            .Select(p => new PackageSummaryResponse(
                p.Id, p.Name, p.Kind, p.DisplayName, p.Summary, p.LicenseSpdx, p.IsDeprecated, p.CreatedAt,
                p.Versions
                    .Where(v => v.YankedAt == null)
                    .OrderByDescending(v => v.PublishedAt)
                    .Select(v => v.Version)
                    .FirstOrDefault()))
            .ToListAsync(ct);

        var hasMore = page.Count > pageSize;
        var packages = hasMore ? page[..pageSize] : page;
        var nextCursor = hasMore ? packages[^1].Name : null;

        return TypedResults.Ok(new PackageListResponse(packages, nextCursor));
    }
}
