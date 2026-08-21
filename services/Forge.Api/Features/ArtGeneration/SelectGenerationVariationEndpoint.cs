using System.Security.Cryptography;
using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.ArtGeneration;

/// <summary>
/// N5: <c>POST /api/v1/workspaces/{ws}/projects/{p}/art-generation/{id}/variations/{variationId}/select</c>
/// — docs/adr/0016's own closing step, and the point where this whole
/// pipeline stops being a preview and becomes real: promotes one Ready
/// <see cref="GenerationVariation"/> into a genuine, named
/// <see cref="Asset"/>, indistinguishable afterward from a hand-uploaded
/// one and immediately eligible for the same Art Pack resolution E4
/// already wired up — the concrete, literal meaning of this session's own
/// standing constraint that AI-assisted generation is additive to the
/// sourced-art pipeline, never a separate one.
///
/// Deliberately not gated on <c>workspace:pro</c> the way Create/Confirm
/// are (<see cref="GetGenerationRequestEndpoint"/>'s own doc comment):
/// the plan-gated cost is generating the images in the first place, not
/// choosing which already-generated one to keep. It still runs the same
/// live storage-quota check <c>UploadAssetEndpoint</c> does, and the same
/// <c>(workspace_id, sha256)</c> dedupe short-circuit — the promoted
/// bytes take the exact same path into <see cref="Asset"/> a hand upload
/// would, quota and all, just starting from <see cref="AssetStatus.Ready"/>
/// directly rather than <see cref="AssetStatus.Pending"/>: the bytes here
/// already ran through <c>Forge.Functions.Assets.AssetRunner</c>'s own
/// decode/re-encode pass once, inside <c>Forge.Functions.ArtGen</c> (N3),
/// so re-queuing them through that same pass a second time would just
/// re-verify what N4's chroma-key step already required to succeed.
/// </summary>
public static class SelectGenerationVariationEndpoint
{
    public static IEndpointRouteBuilder MapSelectGenerationVariation(this IEndpointRouteBuilder app)
    {
        app.MapPost(
                "/api/v1/workspaces/{workspaceId:guid}/projects/{projectId:guid}/art-generation/{id:guid}/variations/{variationId:guid}/select",
                Handle)
            .RequireAuthorization("workspace:write")
            .WithRateLimit("api", RateLimitKeyStrategy.User, RateLimitPolicies.Api)
            .WithName("SelectGenerationVariation")
            .Produces<SelectGenerationVariationResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status402PaymentRequired)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);
        return app;
    }

    private static async Task<IResult> Handle(
        Guid workspaceId,
        Guid projectId,
        Guid id,
        Guid variationId,
        SelectGenerationVariationRequest req,
        ForgeDbContext db,
        ICurrentUser currentUser,
        IArtGenerationStorage generationStorage,
        IAssetStorage assetStorage,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.AssetName))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["assetName"] = ["Required."] });
        }

        var request = await db.GenerationRequests
            .Include(g => g.Variations)
            .SingleOrDefaultAsync(g => g.Id == id && g.WorkspaceId == workspaceId && g.ProjectId == projectId, ct);
        if (request is null)
        {
            return TypedResults.NotFound();
        }

        var variation = request.Variations.SingleOrDefault(v => v.Id == variationId);
        if (variation is null)
        {
            return TypedResults.NotFound();
        }

        if (request.Status != GenerationStatus.Ready)
        {
            return TypedResults.Problem(
                title: "Nothing to select",
                detail: $"This generation request is '{request.Status}', not ready. A variation can only be selected once generation has finished.",
                statusCode: StatusCodes.Status409Conflict);
        }

        var workspace = await db.Workspaces.SingleAsync(w => w.Id == workspaceId, ct);

        byte[] content;
        try
        {
            content = await generationStorage.DownloadVariationAsync(workspaceId, id, variationId, ct);
        }
        catch (ArtGenerationVariationNotFoundException)
        {
            return TypedResults.NotFound();
        }

        // Same live-quota check as UploadAssetEndpoint's own step 3
        // (CLAUDE.md Section 1.5 guardrail 18): a promoted variation
        // counts against the workspace's storage the same as any other
        // asset, so it goes through the identical gate rather than a
        // silent bypass just because the bytes originated from generation.
        var usedBytes = await db.Assets
            .Where(a => a.WorkspaceId == workspaceId && a.DeletedAt == null)
            .SumAsync(a => (long?)a.SizeBytes, ct) ?? 0;
        var quotaBytes = (long)workspace.StorageQuotaMb * 1024 * 1024;
        if (usedBytes + content.Length > quotaBytes)
        {
            return TypedResults.Problem(
                title: "Storage quota exceeded",
                detail: $"This workspace has used {usedBytes} of {quotaBytes} bytes. Delete an asset, or upgrade the plan for more storage.",
                statusCode: StatusCodes.Status402PaymentRequired);
        }

        var sha256 = SHA256.HashData(content);

        // Same (workspace_id, sha256) dedupe short-circuit
        // UploadAssetEndpoint's own step 4 uses -- ux_assets_workspace_sha256
        // is a real unique index, so a second insert with identical bytes
        // would fail the constraint, not just waste storage.
        var existing = await db.Assets
            .Where(a => a.WorkspaceId == workspaceId && a.Sha256 == sha256 && a.DeletedAt == null)
            .Select(a => new { a.Id, a.OriginalName })
            .SingleOrDefaultAsync(ct);
        if (existing is not null)
        {
            foreach (var sibling in request.Variations) sibling.Selected = sibling.Id == variationId;
            await db.SaveChangesAsync(ct);
            return TypedResults.Created($"/api/v1/assets/{existing.Id}", new SelectGenerationVariationResponse(existing.Id, existing.OriginalName));
        }

        var assetId = Guid.NewGuid();
        await assetStorage.UploadProcessedAsync(workspaceId, assetId, content, ct);

        var asset = new Asset
        {
            Id = assetId,
            WorkspaceId = workspaceId,
            ProjectId = projectId,
            OriginalName = req.AssetName,
            DeclaredMimeType = "image/png",
            Status = AssetStatus.Ready,
            // This asset never went through the quarantine stage --
            // Forge.Functions.ArtGen already ran the identical decode/
            // re-encode pass on these bytes before they ever reached a
            // blob (IArtGenerationStorage's own doc comment). This path
            // deliberately never resolves to real content;
            // IAssetStorage.DeleteAsync's own no-op-if-missing contract
            // makes that safe on eventual deletion.
            QuarantineBlobPath = $"art-generation/{id}/{variationId}",
            ProcessedBlobPath = $"{workspaceId}/{assetId}/opt.png",
            Sha256 = sha256,
            SizeBytes = content.Length,
            Width = variation.Width,
            Height = variation.Height,
            RequestedByUserId = currentUser.UserId,
            CreatedAt = DateTimeOffset.UtcNow,
            CompletedAt = DateTimeOffset.UtcNow,
        };
        db.Assets.Add(asset);

        foreach (var sibling in request.Variations) sibling.Selected = sibling.Id == variationId;

        await db.SaveChangesAsync(ct);

        return TypedResults.Created($"/api/v1/assets/{asset.Id}", new SelectGenerationVariationResponse(asset.Id, asset.OriginalName));
    }
}
