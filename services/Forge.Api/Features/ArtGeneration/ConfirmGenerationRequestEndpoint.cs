using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.ArtGeneration;

/// <summary>
/// docs/adr/0016 Decision 2: <c>POST /api/v1/workspaces/{ws}/projects/{p}/art-generation/{id}/confirm</c>.
/// Moves an <see cref="GenerationStatus.AwaitingConfirmation"/> row to
/// <see cref="GenerationStatus.Queued"/> — the actual image-generation
/// call happens off this process, in <c>Forge.Functions.ArtGen</c> (N3),
/// which claims <see cref="GenerationStatus.Queued"/> rows the same
/// optimistic <c>FOR UPDATE SKIP LOCKED</c> way <c>BuildScanner</c>/
/// <c>AssetScanner</c> already claim theirs. This endpoint only ever
/// flips one status column; it never calls Gemini itself.
/// </summary>
public static class ConfirmGenerationRequestEndpoint
{
    public static IEndpointRouteBuilder MapConfirmGenerationRequest(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/workspaces/{workspaceId:guid}/projects/{projectId:guid}/art-generation/{id:guid}/confirm", Handle)
            .RequireAuthorization("workspace:write", "workspace:pro")
            .WithRateLimit("art-generation", RateLimitKeyStrategy.User, RateLimitPolicies.ArtGeneration)
            .WithName("ConfirmGenerationRequest")
            .Produces<GenerationRequestResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        return app;
    }

    private static async Task<IResult> Handle(
        Guid workspaceId,
        Guid projectId,
        Guid id,
        ForgeDbContext db,
        CancellationToken ct)
    {
        var request = await db.GenerationRequests
            .SingleOrDefaultAsync(g => g.Id == id && g.WorkspaceId == workspaceId && g.ProjectId == projectId, ct);
        if (request is null)
        {
            return TypedResults.NotFound();
        }

        if (request.Status != GenerationStatus.AwaitingConfirmation)
        {
            return TypedResults.Problem(
                title: "Nothing to confirm",
                detail: $"This generation request is '{request.Status}', not awaiting confirmation. It may have already been confirmed, or the expansion was declined or failed.",
                statusCode: StatusCodes.Status409Conflict);
        }

        request.Status = GenerationStatus.Queued;
        await db.SaveChangesAsync(ct);

        return TypedResults.Ok(new GenerationRequestResponse(request.Id, request.Category, request.Status, request.ExpandedPrompt, request.ErrorMessage, request.CreatedAt));
    }
}
