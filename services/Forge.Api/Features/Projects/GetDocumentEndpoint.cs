using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Projects;

/// <summary>
/// docs/SPEC.md Section 13.2: <c>GET /api/v1/projects/{id}/document?rev={rev}</c>.
/// Without <c>rev</c>, returns the document at the project's current head
/// revision. A project with no revisions yet (<see cref="Domain.Entities.Project.HeadRevision"/>
/// is null) has no document to return.
/// </summary>
public static class GetDocumentEndpoint
{
    public static IEndpointRouteBuilder MapGetDocument(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/projects/{projectId:guid}/document", Handle)
            .RequireAuthorization("project:read")
            .WithName("GetProjectDocument")
            .Produces<ProjectDocumentResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(Guid projectId, long? rev, ForgeDbContext db, CancellationToken ct)
    {
        var project = await db.Projects
            .Where(p => p.Id == projectId && p.DeletedAt == null)
            .Select(p => new { p.HeadRevision })
            .SingleOrDefaultAsync(ct);
        if (project is null) return TypedResults.NotFound();

        var targetRevisionId = rev ?? project.HeadRevision;
        if (targetRevisionId is null) return TypedResults.NotFound();

        var revision = await db.ProjectRevisions
            .Where(r => r.ProjectId == projectId && r.Id == targetRevisionId)
            .SingleOrDefaultAsync(ct);
        if (revision is null) return TypedResults.NotFound();

        return TypedResults.Ok(new ProjectDocumentResponse(revision.Id, revision.ParentId, revision.Label, revision.Doc, revision.CreatedAt));
    }
}
