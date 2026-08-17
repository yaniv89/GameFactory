using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Builds;

/// <summary>
/// docs/adr/0010 Decision 3: <c>POST /api/v1/projects/{id}/builds</c>.
/// Publishes the project's latest *committed* revision — never the live,
/// possibly-mid-edit in-editor document, which was never confirmed as a
/// checkpoint. Only queues the row; <c>Forge.Functions.Build</c> (C3)
/// does the actual bundling off this process, matching
/// <c>Forge.Functions.Scan</c>'s existing claim/process split.
/// </summary>
public static class CreateBuildEndpoint
{
    public static IEndpointRouteBuilder MapCreateBuild(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/projects/{projectId:guid}/builds", Handle)
            // Both required (docs/adr/0010 Decision 3, SPEC 23.2/23.5's
            // "Free doesn't publish at all" wall): a workspace Editor/Admin
            // role AND a Pro/Studio plan. See
            // WorkspaceAuthorizationMiddlewareResultHandler's own doc
            // comment for why combining these two named policies needed a
            // fix there first — a plain non-member must still get 404, not
            // a plan-upgrade prompt that discloses the project exists.
            .RequireAuthorization("project:write", "project:pro")
            .WithRateLimit("create-build", RateLimitKeyStrategy.User, RateLimitPolicies.CreateBuild)
            .WithName("CreateBuild")
            .Produces<CreateBuildResponse>(StatusCodes.Status202Accepted)
            .ProducesProblem(StatusCodes.Status400BadRequest)
            .ProducesProblem(StatusCodes.Status402PaymentRequired)
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(Guid projectId, ForgeDbContext db, ICurrentUser currentUser, CancellationToken ct)
    {
        // A single projection, not p.HeadRevision alone: SingleOrDefaultAsync
        // on a bare nullable long can't distinguish "no project row at
        // all" from "project exists, HeadRevision is null" — both would
        // come back as the same default null. Projecting into a
        // reference-type shape keeps that distinction (the whole object
        // is null only when no project row matched), so project:write
        // having already resolved this project exists for this caller's
        // workspace doesn't get papered over by a genuinely rare
        // concurrent-delete race here.
        var project = await db.Projects
            .Where(p => p.Id == projectId && p.DeletedAt == null)
            .Select(p => new { p.HeadRevision })
            .SingleOrDefaultAsync(ct);

        if (project is null)
        {
            return TypedResults.NotFound();
        }

        if (project.HeadRevision is not { } revisionId)
        {
            return TypedResults.Problem(
                title: "Nothing to publish yet",
                detail: "Commit at least one revision before publishing this project.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        var build = new Build
        {
            Id = Guid.NewGuid(),
            ProjectId = projectId,
            RevisionId = revisionId,
            Status = BuildStatus.Queued,
            RequestedByUserId = currentUser.UserId,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Builds.Add(build);
        await db.SaveChangesAsync(ct);

        return TypedResults.Accepted(
            $"/api/v1/projects/{projectId}/builds/{build.Id}",
            new CreateBuildResponse(build.Id, build.Status, build.CreatedAt));
    }
}
