using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.ArtGeneration;

/// <summary>
/// N5: <c>GET /api/v1/workspaces/{ws}/projects/{p}/art-generation/{id}</c>
/// — the poll target the editor's "Describe it" dialog uses to learn when
/// <c>Forge.Functions.ArtGen</c> (N3/N4) has moved a confirmed request
/// from <see cref="GenerationStatus.Queued"/>/<see cref="GenerationStatus.Generating"/>
/// to a terminal state. Read-only, so it's gated on <c>workspace:read</c>
/// alone, not <c>workspace:pro</c> — a workspace that started generation
/// while Pro and was later downgraded can still see the result of a
/// request it already paid the daily-budget/rate-limit cost for; only
/// starting a *new* one is plan-gated.
/// </summary>
public static class GetGenerationRequestEndpoint
{
    public static IEndpointRouteBuilder MapGetGenerationRequest(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/workspaces/{workspaceId:guid}/projects/{projectId:guid}/art-generation/{id:guid}", Handle)
            .RequireAuthorization("workspace:read")
            .WithRateLimit("api", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("GetGenerationRequest")
            .Produces<GenerationRequestResponse>()
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(Guid workspaceId, Guid projectId, Guid id, ForgeDbContext db, CancellationToken ct)
    {
        var request = await db.GenerationRequests
            .Where(g => g.Id == id && g.WorkspaceId == workspaceId && g.ProjectId == projectId)
            .Select(g => new
            {
                g.Id,
                g.Category,
                g.Status,
                g.ExpandedPrompt,
                g.ErrorMessage,
                g.CreatedAt,
                Variations = g.Variations.Select(v => new GenerationVariationResponse(v.Id, v.Width, v.Height, v.Selected)).ToList(),
            })
            .SingleOrDefaultAsync(ct);
        if (request is null)
        {
            return TypedResults.NotFound();
        }

        return TypedResults.Ok(new GenerationRequestResponse(
            request.Id, request.Category, request.Status, request.ExpandedPrompt, request.ErrorMessage, request.CreatedAt, request.Variations));
    }
}
