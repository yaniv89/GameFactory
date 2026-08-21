using Forge.Api.RateLimiting;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.ArtGeneration;

/// <summary>
/// N5: <c>GET /api/v1/workspaces/{ws}/projects/{p}/art-generation/{id}/variations/{variationId}/content</c>
/// — serves one <see cref="Domain.Entities.GenerationVariation"/>'s real
/// bytes to an authenticated workspace member, the same shape
/// <c>Forge.Api.Features.Assets.GetAssetContentEndpoint</c> already
/// established for a Ready asset: never a directly public blob URL
/// (<see cref="IArtGenerationStorage"/>'s own doc comment), always
/// through this authorization check first. Unlike that endpoint, this one
/// is keyed by the variation's own database id rather than a
/// creator-assigned path — a variation has no name of its own until
/// (and unless) <see cref="SelectGenerationVariationEndpoint"/> promotes
/// it into a named <see cref="Domain.Entities.Asset"/>.
/// </summary>
public static class GetGenerationVariationContentEndpoint
{
    public static IEndpointRouteBuilder MapGetGenerationVariationContent(this IEndpointRouteBuilder app)
    {
        app.MapGet(
                "/api/v1/workspaces/{workspaceId:guid}/projects/{projectId:guid}/art-generation/{id:guid}/variations/{variationId:guid}/content",
                Handle)
            .RequireAuthorization("workspace:read")
            .WithRateLimit("api", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("GetGenerationVariationContent")
            .Produces(StatusCodes.Status200OK, contentType: "image/png")
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(
        Guid workspaceId, Guid projectId, Guid id, Guid variationId, ForgeDbContext db, IArtGenerationStorage storage, CancellationToken ct)
    {
        var exists = await db.GenerationVariations
            .AnyAsync(v => v.Id == variationId
                && v.GenerationRequestId == id
                && v.GenerationRequest!.WorkspaceId == workspaceId
                && v.GenerationRequest.ProjectId == projectId, ct);
        if (!exists)
        {
            return TypedResults.NotFound();
        }

        byte[] content;
        try
        {
            content = await storage.DownloadVariationAsync(workspaceId, id, variationId, ct);
        }
        catch (ArtGenerationVariationNotFoundException)
        {
            // A row the query above just confirmed exists, but no blob --
            // a genuine consistency problem (CLAUDE.md guardrail 11:
            // surfaced, not swallowed), same as GetAssetContentEndpoint's
            // own AssetProcessedNotFoundException handling: the caller
            // still just gets an honest 404.
            return TypedResults.NotFound();
        }

        return TypedResults.File(content, "image/png");
    }
}
