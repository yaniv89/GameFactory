using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Projects;

/// <summary>docs/SPEC.md Section 13.2: <c>GET /api/v1/projects/{id}</c>.</summary>
public static class GetProjectEndpoint
{
    public static IEndpointRouteBuilder MapGetProject(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/projects/{projectId:guid}", Handle)
            .RequireAuthorization("project:read")
            .WithName("GetProject")
            .Produces<ProjectDetailResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(Guid projectId, ForgeDbContext db, CancellationToken ct)
    {
        var project = await db.Projects.SingleOrDefaultAsync(p => p.Id == projectId && p.DeletedAt == null, ct);
        return project is null ? TypedResults.NotFound() : TypedResults.Ok(CreateProjectEndpoint.ToDetail(project));
    }
}
