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
        // one is exactly ["name-part"]. "versions", if present, is the
        // segment immediately after the name ends.
        var versionsIndex = Array.IndexOf(segments, "versions");
        var nameSegmentCount = versionsIndex < 0 ? segments.Length : versionsIndex;
        if (nameSegmentCount is not (1 or 2))
        {
            return TypedResults.NotFound();
        }
        var name = string.Join('/', segments[..nameSegmentCount]);

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
        var package = await db.Packages
            .Where(p => p.Name == name)
            .Select(p => new PackageDetailResponse(
                p.Id, p.Name, p.Kind, p.AuthorUserId, p.DisplayName, p.Summary,
                p.ReadmeMarkdown, p.HomepageUrl, p.LicenseSpdx, p.IsDeprecated, p.CreatedAt))
            .SingleOrDefaultAsync(ct);

        return package is null ? TypedResults.NotFound() : TypedResults.Ok(package);
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
