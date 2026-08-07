using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Projects;

/// <summary>
/// docs/SPEC.md Section 13.2: <c>DELETE /api/v1/projects/{id}</c>. Soft
/// delete only — sets <c>deleted_at</c>, same pattern <see cref="Domain.Entities.Workspace"/>
/// and <see cref="Domain.Entities.User"/> already use. The revision log
/// (and everything derived from it: builds, exports) is never destroyed
/// by this endpoint; a hard-delete/purge path is a separate, deliberate
/// decision this endpoint does not make.
/// </summary>
public static class DeleteProjectEndpoint
{
    public static IEndpointRouteBuilder MapDeleteProject(this IEndpointRouteBuilder app)
    {
        app.MapDelete("/api/v1/projects/{projectId:guid}", Handle)
            .RequireAuthorization("project:write")
            .WithName("DeleteProject")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(Guid projectId, ForgeDbContext db, CancellationToken ct)
    {
        var project = await db.Projects.SingleOrDefaultAsync(p => p.Id == projectId && p.DeletedAt == null, ct);
        if (project is null) return TypedResults.NotFound();

        project.DeletedAt = DateTimeOffset.UtcNow;
        project.UpdatedAt = project.DeletedAt.Value;
        await db.SaveChangesAsync(ct);

        return TypedResults.NoContent();
    }
}
