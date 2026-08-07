using System.Text.Json;
using Forge.Api.Authorization;
using Forge.Infrastructure.Persistence;

namespace Forge.Api.Features.Projects;

/// <summary>
/// docs/SPEC.md Section 13.3: <c>POST /api/v1/projects/{id}/revisions</c>.
/// The most important write path — it must handle concurrent commits
/// without losing work, which is why the actual commit logic lives in
/// <see cref="RevisionCommitService"/> under Serializable isolation
/// rather than here.
/// </summary>
public static class CommitRevisionEndpoint
{
    private const int MaxDocumentBytes = 32 * 1024 * 1024; // 32 MB, per docs/SPEC.md Section 13.3.

    public static IEndpointRouteBuilder MapCommitRevision(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/projects/{projectId:guid}/revisions", Handle)
            .RequireAuthorization("project:write")
            .WithName("CommitRevision")
            .Produces<CommitRevisionResponse>(StatusCodes.Status201Created)
            .Produces<CommitRevisionResponse>(StatusCodes.Status200OK)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge);
        return app;
    }

    private static async Task<IResult> Handle(
        Guid projectId,
        CommitRevisionRequest req,
        ForgeDbContext db,
        ICurrentUser currentUser,
        IDocumentValidator validator,
        ILogger<ForgeDbContext> log,
        CancellationToken ct)
    {
        var raw = JsonSerializer.SerializeToUtf8Bytes(req.Document);
        if (raw.Length > MaxDocumentBytes)
        {
            return TypedResults.Problem(
                title: "Project document too large",
                detail: $"Document is {raw.Length} bytes. Limit is {MaxDocumentBytes}.",
                statusCode: StatusCodes.Status413PayloadTooLarge);
        }

        var validation = await validator.ValidateAsync(req.Document, ct);
        if (!validation.IsValid)
        {
            return TypedResults.ValidationProblem(validation.Errors);
        }

        var result = await RevisionCommitService.CommitAsync(
            db, projectId, currentUser.UserId, req.ExpectedHeadRevision, req.Label, req.IsCheckpoint, req.Document, ct);

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
                return TypedResults.Ok(new CommitRevisionResponse(
                    result.Revision!.Id, Convert.ToHexString(result.Revision.DocHash), result.Revision.CreatedAt));

            case CommitResultKind.Committed:
            default:
                log.LogInformation(
                    "Committed revision {RevisionId} for project {ProjectId} ({Bytes} bytes)",
                    result.Revision!.Id, projectId, raw.Length);
                return TypedResults.Created(
                    $"/api/v1/projects/{projectId}/revisions/{result.Revision.Id}",
                    new CommitRevisionResponse(result.Revision.Id, Convert.ToHexString(result.Revision.DocHash), result.Revision.CreatedAt));
        }
    }
}
