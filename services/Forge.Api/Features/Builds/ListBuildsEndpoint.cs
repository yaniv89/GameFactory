using Forge.Api.RateLimiting;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Builds;

/// <summary>
/// docs/adr/0010 Decision 3: <c>GET /api/v1/projects/{id}/builds</c>,
/// newest first. No keyset cursor yet, unlike <c>ListRevisionsEndpoint</c>:
/// a project's build history is bounded by how often a creator actually
/// publishes, not by how often they edit, so a plain <c>Take(limit)</c>
/// backed by <c>ix_builds_project_created</c> (<see cref="Persistence.Configurations.BuildConfiguration"/>)
/// is a complete v1, not a half-finished one — real pagination is a
/// straightforward, isolated addition if a project's build count ever
/// makes that untrue.
/// </summary>
public static class ListBuildsEndpoint
{
    private const int DefaultLimit = 20;
    private const int MaxLimit = 100;

    public static IEndpointRouteBuilder MapListBuilds(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/projects/{projectId:guid}/builds", Handle)
            .RequireAuthorization("project:read")
            .WithRateLimit("api", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("ListBuilds")
            .Produces<BuildListResponse>();
        return app;
    }

    private static async Task<IResult> Handle(Guid projectId, int? limit, ForgeDbContext db, CancellationToken ct)
    {
        var pageSize = Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit);

        var builds = await db.Builds
            .Where(b => b.ProjectId == projectId)
            .OrderByDescending(b => b.CreatedAt)
            .Take(pageSize)
            .Select(b => new BuildSummaryResponse(b.Id, b.RevisionId, b.Status, b.CreatedAt, b.CompletedAt))
            .ToListAsync(ct);

        return TypedResults.Ok(new BuildListResponse(builds));
    }
}
