using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Assets;

/// <summary>
/// docs/adr/0012's own gap, closed for E4: nothing before this endpoint
/// ever served a processed asset's real bytes anywhere. Path-keyed, not
/// asset-id-keyed — <c>GET /api/v1/workspaces/{ws}/assets/content/{*path}</c>
/// — deliberately, so this composes with <c>@forge/art-pack</c>'s own
/// <c>resolveAsset</c> contract unchanged: <c>AssetSource.baseUrl</c> is a
/// single shared prefix a caller appends a project-relative path to
/// (exactly how tier 3's active-pack/tier 4's module-bundled sources
/// already work), and every project-uploaded asset in a workspace now
/// lives under one such prefix — <c>OriginalName</c> doubles as that
/// resolution path (docs/SPEC.md Section 11.4's own
/// <c>assets/path/to/asset.png</c> wording: one shared namespace, not one
/// URL per asset id).
///
/// "Most recent <c>Ready</c> row for this path wins" rather than a hard
/// uniqueness constraint: a creator re-uploading the same path is
/// expected to see their new version, and enforcing uniqueness at write
/// time would need a new migration/constraint this phase doesn't need —
/// a stated simplification, not a silent one.
/// </summary>
public static class GetAssetContentEndpoint
{
    public static IEndpointRouteBuilder MapGetAssetContent(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/workspaces/{workspaceId:guid}/assets/content/{*path}", Handle)
            .RequireAuthorization("workspace:read")
            .WithName("GetAssetContent")
            .Produces(StatusCodes.Status200OK, contentType: "image/png")
            .ProducesProblem(StatusCodes.Status404NotFound);
        return app;
    }

    private static async Task<IResult> Handle(Guid workspaceId, string path, ForgeDbContext db, IAssetStorage storage, CancellationToken ct)
    {
        var assetId = await db.Assets
            .Where(a => a.WorkspaceId == workspaceId && a.OriginalName == path && a.Status == AssetStatus.Ready && a.DeletedAt == null)
            .OrderByDescending(a => a.CreatedAt)
            .Select(a => (Guid?)a.Id)
            .FirstOrDefaultAsync(ct);
        if (assetId is null)
        {
            return TypedResults.NotFound();
        }

        byte[] content;
        try
        {
            content = await storage.DownloadProcessedAsync(workspaceId, assetId.Value, ct);
        }
        catch (AssetProcessedNotFoundException)
        {
            // The row says Ready but the blob is gone — a genuine
            // consistency problem (CLAUDE.md guardrail 11: surfaced, not
            // swallowed), but the caller still just gets an honest 404
            // rather than a 500 for something it can't act on either way.
            return TypedResults.NotFound();
        }

        // Never the client-declared DeclaredMimeType (docs/adr/0012
        // Decision 7) — this is what Forge.Functions.Assets actually
        // produced. Not marked immutable/long-lived: unlike a build's
        // content-addressed buildId, this path can point at different
        // bytes over time (a newer upload of the same path), so caching
        // stays conservative rather than risking a stale sprite that
        // survives a re-upload in a shared/browser cache.
        return TypedResults.File(content, "image/png");
    }
}
