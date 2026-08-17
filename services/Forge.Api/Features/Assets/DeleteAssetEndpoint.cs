using Forge.Api.RateLimiting;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Assets;

/// <summary>
/// docs/adr/0012 Decision 6: <c>DELETE /api/v1/assets/{id}</c>. Deletes
/// both blobs synchronously — a <c>Ready</c> asset's quarantine copy has
/// already served its only purpose, and a <c>Pending</c>/<c>Failed</c>
/// row never got a processed one, so <see cref="IAssetStorage.DeleteAsync"/>
/// handles either case as a no-op for whichever blob doesn't exist — then
/// marks the row deleted. Never a hard row delete, matching every other
/// soft-deleted entity in this schema (<c>Project</c>, <c>Workspace</c>).
/// </summary>
public static class DeleteAssetEndpoint
{
    public static IEndpointRouteBuilder MapDeleteAsset(this IEndpointRouteBuilder app)
    {
        app.MapDelete("/api/v1/assets/{assetId:guid}", Handle)
            .RequireAuthorization("asset:write")
            .WithRateLimit("api", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("DeleteAsset")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(Guid assetId, ForgeDbContext db, IAssetStorage storage, CancellationToken ct)
    {
        var asset = await db.Assets.SingleOrDefaultAsync(a => a.Id == assetId && a.DeletedAt == null, ct);
        if (asset is null)
        {
            return TypedResults.NotFound();
        }

        await storage.DeleteAsync(asset.WorkspaceId, asset.Id, ct);

        asset.DeletedAt = DateTimeOffset.UtcNow;
        await db.SaveChangesAsync(ct);

        return TypedResults.NoContent();
    }
}
