using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Domain.Marketplace;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Registry;

/// <summary>
/// docs/SPEC.md Section 13.2: <c>GET /api/v1/packages?q=&amp;kind=&amp;cursor=&amp;sort=</c>.
/// Anonymous — browsing the catalog needs no more authentication than
/// npm's own registry API does (docs/SPEC.md Section 16's marketplace is
/// a public storefront, not a workspace-scoped resource).
///
/// Two sort modes:
/// - Default (no <c>sort</c>, or <c>sort=name</c>): cursor-paginated on
///   <c>name</c> (globally unique, so it's a complete order on its own),
///   ascending alphabetical — real, stable, and cursor-continuable.
/// - <c>sort=ranked</c> (M7 Phase 6): <see cref="PackageRankingCalculator"/>'s
///   weighted composite score (docs/SPEC.md Section 16.2), computed over
///   a bounded, SQL-filtered candidate set rather than the whole catalog
///   (CLAUDE.md Section 1.5 guardrail 21 — no unbounded per-request scan)
///   and sorted in memory, since the composite formula isn't a single
///   SQL-translatable expression this endpoint can push into
///   <c>ORDER BY</c>. <c>MaxRankedCandidates</c> bounds the worst case;
///   past that point a precomputed, periodically-refreshed ranking
///   column would be the real fix, not something this catalog's current
///   size (an early-stage marketplace, not a user/event table) needs
///   yet — a stated scaling limit, not a silent one. Ranked mode doesn't
///   accept <c>cursor</c>: a computed order has no stable cursor to
///   resume from without a precomputed, snapshotted rank.
/// </summary>
public static class ListPackagesEndpoint
{
    private const int DefaultLimit = 20;
    private const int MaxLimit = 100;

    /// <summary>Worst-case candidate set scored in memory per ranked-sort request — see this class's own doc comment on why this is a stated bound, not an unbounded scan.</summary>
    private const int MaxRankedCandidates = 500;

    public static IEndpointRouteBuilder MapListPackages(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/packages", Handle)
            .WithRateLimit("registry", RateLimitKeyStrategy.IpAddress, RateLimitPolicies.Registry)
            .WithName("ListPackages")
            .Produces<PackageListResponse>()
            .ProducesValidationProblem();
        return app;
    }

    private static async Task<IResult> Handle(
        string? q, string? kind, string? cursor, int? limit, string? sort, ForgeDbContext db, CancellationToken ct)
    {
        if (kind is not null && !PackageKind.All.Contains(kind))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["kind"] = [$"Must be one of: {string.Join(", ", PackageKind.All)}."],
            });
        }

        if (sort is not null && sort is not ("name" or "ranked"))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["sort"] = ["Must be one of: name, ranked."],
            });
        }

        if (sort == "ranked" && cursor is not null)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["cursor"] = ["sort=ranked doesn't support cursor pagination — a computed rank has no stable position to resume from."],
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

        return sort == "ranked"
            ? await HandleRankedAsync(query, pageSize, ct)
            : await HandleAlphabeticalAsync(query, cursor, pageSize, ct);
    }

    private static async Task<IResult> HandleAlphabeticalAsync(IQueryable<Package> query, string? cursor, int pageSize, CancellationToken ct)
    {
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

    private static async Task<IResult> HandleRankedAsync(IQueryable<Package> query, int pageSize, CancellationToken ct)
    {
        // Only a package with at least one published, gate-4-passed,
        // non-yanked version is rankable at all — an unpublished or
        // fully-yanked package has nothing a buyer could install.
        var rankable = query.Where(p => p.Versions.Any(v => v.YankedAt == null && v.ScanStatus == PackageScanStatus.Passed));

        var candidates = await rankable
            // A cheap, real ORDER BY for the bounded SQL-side cap —
            // recency of the latest passed version, not the eventual
            // rank score itself (which isn't computed until after this
            // candidate set is already materialized).
            .OrderByDescending(p => p.Versions
                .Where(v => v.YankedAt == null && v.ScanStatus == PackageScanStatus.Passed)
                .Max(v => v.PublishedAt))
            .Take(MaxRankedCandidates)
            .Select(p => new
            {
                p.Id,
                p.Name,
                p.Kind,
                p.DisplayName,
                p.Summary,
                p.LicenseSpdx,
                p.IsDeprecated,
                p.CreatedAt,
                ReadmeLength = p.ReadmeMarkdown != null ? p.ReadmeMarkdown.Length : 0,
                Latest = p.Versions
                    .Where(v => v.YankedAt == null && v.ScanStatus == PackageScanStatus.Passed)
                    .OrderByDescending(v => v.PublishedAt)
                    .Select(v => new { v.Version, v.SizeBytes, v.PublishedAt, v.MeasuredAverageTickMs })
                    .FirstOrDefault(),
            })
            .ToListAsync(ct);

        var now = DateTimeOffset.UtcNow;
        var ranked = candidates
            .Select(c => new
            {
                c,
                Score = PackageRankingCalculator.CalculateScore(
                    new ListingQualitySignals(
                        ActiveInstalls30d: null,
                        BayesianRating: null,
                        LatestVersionPublishedAt: c.Latest?.PublishedAt,
                        MeasuredAverageTickMs: c.Latest?.MeasuredAverageTickMs,
                        LatestVersionSizeBytes: c.Latest?.SizeBytes,
                        ReadmeLength: c.ReadmeLength,
                        SupportResponsivenessHours: null),
                    now),
            })
            .OrderByDescending(x => x.Score)
            .Take(pageSize)
            .Select(x => new PackageSummaryResponse(
                x.c.Id, x.c.Name, x.c.Kind, x.c.DisplayName, x.c.Summary, x.c.LicenseSpdx, x.c.IsDeprecated, x.c.CreatedAt,
                x.c.Latest?.Version))
            .ToList();

        // No nextCursor — see this class's own doc comment on why ranked
        // mode doesn't support cursor continuation.
        return TypedResults.Ok(new PackageListResponse(ranked, NextCursor: null));
    }
}
