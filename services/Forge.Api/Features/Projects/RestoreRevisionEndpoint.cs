using Forge.Api.Authorization;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Projects;

/// <summary>
/// docs/SPEC.md Section 13.2: <c>POST /api/v1/projects/{id}/revisions/{rev}/restore</c>.
/// Forward-only, like the rest of the log: restoring an old revision
/// commits its document as a brand new head (via the same
/// <see cref="RevisionCommitService"/> path <see cref="CommitRevisionEndpoint"/>
/// uses) rather than rewinding history, so nothing already committed is
/// ever lost. Takes the same <c>expectedHeadRevision</c> optimistic-
/// concurrency token as a normal commit for the same reason: restoring
/// over a change you haven't seen yet is exactly the conflict a commit
/// would be.
/// </summary>
public static class RestoreRevisionEndpoint
{
    public static IEndpointRouteBuilder MapRestoreRevision(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/projects/{projectId:guid}/revisions/{revisionId:long}/restore", Handle)
            .RequireAuthorization("project:write")
            .WithName("RestoreRevision")
            .Produces<CommitRevisionResponse>(StatusCodes.Status201Created)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        return app;
    }

    private static async Task<IResult> Handle(
        Guid projectId,
        long revisionId,
        RestoreRevisionRequest req,
        ForgeDbContext db,
        ICurrentUser currentUser,
        CancellationToken ct)
    {
        var source = await db.ProjectRevisions
            .Where(r => r.ProjectId == projectId && r.Id == revisionId)
            .SingleOrDefaultAsync(ct);
        if (source is null) return TypedResults.NotFound();

        var label = string.IsNullOrWhiteSpace(req.Label) ? $"Restored from revision {revisionId}" : req.Label;

        var result = await RevisionCommitService.CommitAsync(
            db, projectId, currentUser.UserId, req.ExpectedHeadRevision, label, isCheckpoint: true, source.Doc, ct);

        switch (result.Kind)
        {
            case CommitResultKind.ProjectNotFound:
                return TypedResults.NotFound();

            case CommitResultKind.Conflict:
                return TypedResults.Problem(
                    title: "Revision conflict",
                    detail: "The project changed since you loaded it. Rebase and retry.",
                    statusCode: StatusCodes.Status409Conflict,
                    extensions: new Dictionary<string, object?>
                    {
                        ["actualHeadRevision"] = result.ActualHeadRevision,
                        ["expectedHeadRevision"] = req.ExpectedHeadRevision,
                    });

            case CommitResultKind.Deduplicated:
            case CommitResultKind.Committed:
            default:
                return TypedResults.Created(
                    $"/api/v1/projects/{projectId}/revisions/{result.Revision!.Id}",
                    new CommitRevisionResponse(result.Revision.Id, Convert.ToHexString(result.Revision.DocHash), result.Revision.CreatedAt));
        }
    }
}
