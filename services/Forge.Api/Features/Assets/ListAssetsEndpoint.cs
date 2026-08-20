using Forge.Api.RateLimiting;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Assets;

/// <summary>
/// docs/adr/0012: <c>GET /api/v1/workspaces/{ws}/assets</c>, newest first.
/// Limit-only, no keyset cursor yet — the same trade
/// <see cref="Features.Builds.ListBuildsEndpoint"/>'s own doc comment
/// already names for the identical reason: an account's asset count is
/// bounded by how much it uploads, not a runaway growth pattern, so a
/// plain <c>Take(limit)</c> backed by <c>ix_assets_workspace_created</c>
/// is a complete v1, not a half-finished one.
/// </summary>
public static class ListAssetsEndpoint
{
    private const int DefaultLimit = 50;
    private const int MaxLimit = 200;

    public static IEndpointRouteBuilder MapListAssets(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/workspaces/{workspaceId:guid}/assets", Handle)
            .RequireAuthorization("workspace:read")
            .WithRateLimit("api", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("ListAssets")
            .Produces<AssetListResponse>();
        return app;
    }

    private static async Task<IResult> Handle(Guid workspaceId, Guid? projectId, int? limit, ForgeDbContext db, CancellationToken ct)
    {
        var pageSize = Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit);

        var query = db.Assets.Where(a => a.WorkspaceId == workspaceId && a.DeletedAt == null);
        if (projectId is { } pid) query = query.Where(a => a.ProjectId == pid);

        var assets = await query
            .OrderByDescending(a => a.CreatedAt)
            .Take(pageSize)
            .Select(a => new AssetSummaryResponse(a.Id, a.ProjectId, a.OriginalName, a.Status, a.SizeBytes, a.Width, a.Height, a.ErrorMessage, a.CreatedAt, a.CompletedAt))
            .ToListAsync(ct);

        return TypedResults.Ok(new AssetListResponse(assets));
    }
}
