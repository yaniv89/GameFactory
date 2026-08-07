using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Projects;

/// <summary>docs/SPEC.md Section 13.2: <c>GET /api/v1/workspaces/{ws}/projects</c>.</summary>
public static class ListProjectsEndpoint
{
    public static IEndpointRouteBuilder MapListProjects(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/workspaces/{workspaceId:guid}/projects", Handle)
            .RequireAuthorization("workspace:read")
            .WithName("ListProjects")
            .Produces<IReadOnlyList<ProjectSummaryResponse>>();
        return app;
    }

    private static async Task<IResult> Handle(Guid workspaceId, ForgeDbContext db, CancellationToken ct)
    {
        // Backed by the existing unique index on (workspace_id, slug):
        // workspace_id is its leading column, so this WHERE clause is an
        // index scan, not a table scan, without a dedicated new index.
        var projects = await db.Projects
            .Where(p => p.WorkspaceId == workspaceId && p.DeletedAt == null)
            .OrderByDescending(p => p.UpdatedAt)
            .Select(p => new ProjectSummaryResponse(p.Id, p.WorkspaceId, p.Slug, p.Title, p.Visibility, p.HeadRevision, p.CreatedAt, p.UpdatedAt))
            .ToListAsync(ct);

        return TypedResults.Ok(projects);
    }
}
