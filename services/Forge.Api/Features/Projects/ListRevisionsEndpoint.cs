using Forge.Api.RateLimiting;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Projects;

/// <summary>
/// docs/SPEC.md Section 13.2: <c>GET /api/v1/projects/{id}/revisions</c>,
/// cursor-paginated. The cursor is the last-seen revision id: ids are a
/// monotonic <c>BIGSERIAL</c>, assigned inside <see cref="RevisionCommitService"/>'s
/// Serializable-isolation transaction, so id order and commit order are
/// the same thing — no separate timestamp-based cursor is needed. Backed
/// by the <c>ix_revisions_project_id</c> index on
/// <c>(project_id, id)</c> added alongside this endpoint.
/// </summary>
public static class ListRevisionsEndpoint
{
    private const int DefaultLimit = 20;
    private const int MaxLimit = 100;

    public static IEndpointRouteBuilder MapListRevisions(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/projects/{projectId:guid}/revisions", Handle)
            .RequireAuthorization("project:read")
            .WithRateLimit("api", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("ListRevisions")
            .Produces<RevisionHistoryResponse>();
        return app;
    }

    private static async Task<IResult> Handle(Guid projectId, long? cursor, int? limit, ForgeDbContext db, CancellationToken ct)
    {
        var pageSize = Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit);

        var query = db.ProjectRevisions.Where(r => r.ProjectId == projectId);
        if (cursor is { } after) query = query.Where(r => r.Id < after);

        var page = await query
            .OrderByDescending(r => r.Id)
            .Take(pageSize + 1)
            .Select(r => new RevisionSummaryResponse(r.Id, r.ParentId, r.AuthorId, r.Label, r.SizeBytes, r.IsCheckpoint, r.CreatedAt))
            .ToListAsync(ct);

        var hasMore = page.Count > pageSize;
        var revisions = hasMore ? page[..pageSize] : page;
        var nextCursor = hasMore ? revisions[^1].Id : (long?)null;

        return TypedResults.Ok(new RevisionHistoryResponse(revisions, nextCursor));
    }
}
