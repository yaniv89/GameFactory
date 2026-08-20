using System.Security.Cryptography;
using Forge.Api.Authorization;
using Forge.Api.RateLimiting;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Forge.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Assets;

/// <summary>
/// docs/adr/0012 Decision 3: <c>POST /api/v1/workspaces/{ws}/assets</c>.
/// Moves uploaded bytes into the private quarantine container without
/// ever decoding them — <c>Forge.Api</c> is precisely the process T6's
/// threat-table entry (docs/security/THREAT-MODEL.md Section 3.9) says
/// must not run an image decoder. The only real processing happens later,
/// off this process, in <c>Forge.Functions.Assets</c> (E3) — this
/// endpoint only ever writes a <see cref="AssetStatus.Pending"/> row.
/// </summary>
public static class UploadAssetEndpoint
{
    // docs/adr/0012 Decision 1: exactly these three, nothing else — most
    // importantly not image/svg+xml, which is inline-executable markup,
    // not raster data. Accepting it as an "image" would reopen T7's
    // CWE-79 hole through a different input path than @forge/richtext
    // (docs/adr/0011) exists to close.
    private static readonly IReadOnlySet<string> AllowedMimeTypes = new HashSet<string>(StringComparer.Ordinal)
    {
        "image/png", "image/jpeg", "image/webp",
    };

    // docs/adr/0012 Decision 3: generous for a single sprite sheet or
    // tileset per SPEC 11.2's own grid sizes — a resource-abuse guard the
    // same way PublishVersionEndpoint.MaxBundleBytes is, not a claim about
    // what a "good" asset size is.
    private const long MaxOriginalBytes = 10 * 1024 * 1024;

    public static IEndpointRouteBuilder MapUploadAsset(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/workspaces/{workspaceId:guid}/assets", Handle)
            .RequireAuthorization("workspace:write")
            .WithRateLimit("assets-upload", RateLimitKeyStrategy.User, RateLimitPolicies.AssetUpload)
            .WithName("UploadAsset")
            .Produces<UploadAssetResponse>(StatusCodes.Status202Accepted)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status402PaymentRequired)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge);
        return app;
    }

    private static async Task<IResult> Handle(
        Guid workspaceId,
        UploadAssetRequest req,
        ForgeDbContext db,
        ICurrentUser currentUser,
        IAssetStorage storage,
        CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(req.OriginalName))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["originalName"] = ["Required."] });
        }
        if (!AllowedMimeTypes.Contains(req.DeclaredMimeType))
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["declaredMimeType"] = [$"'{req.DeclaredMimeType}' is not accepted. Upload one of: {string.Join(", ", AllowedMimeTypes)}."],
            });
        }

        var workspace = await db.Workspaces.SingleOrDefaultAsync(w => w.Id == workspaceId && w.DeletedAt == null, ct);
        if (workspace is null)
        {
            return TypedResults.NotFound();
        }

        if (req.ProjectId is { } projectId)
        {
            var projectWorkspace = await db.Projects
                .Where(p => p.Id == projectId && p.DeletedAt == null)
                .Select(p => (Guid?)p.WorkspaceId)
                .SingleOrDefaultAsync(ct);
            // Same cross-tenant-404 spirit as everywhere else: a project
            // id from a different workspace (or one that doesn't exist at
            // all) is indistinguishable from "not found," never disclosed
            // via a different status code (CLAUDE.md Section 1.1 guardrail 4).
            if (projectWorkspace != workspaceId)
            {
                return TypedResults.NotFound();
            }
        }

        byte[] originalBytes;
        try
        {
            originalBytes = Convert.FromBase64String(req.ContentBase64);
        }
        catch (FormatException)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["contentBase64"] = ["Not valid base64."] });
        }
        if (originalBytes.Length == 0)
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]> { ["contentBase64"] = ["File must not be empty."] });
        }
        if (originalBytes.Length > MaxOriginalBytes)
        {
            return TypedResults.Problem(
                title: "File too large",
                detail: $"'{req.OriginalName}' is {originalBytes.Length} bytes. The limit is {MaxOriginalBytes} bytes.",
                statusCode: StatusCodes.Status413PayloadTooLarge);
        }

        // docs/adr/0012 Decision 3 step 3: computed live against the real
        // current total, never a cached counter (CLAUDE.md Section 1.5
        // guardrail 18 — no in-process state a load balancer can't
        // redistribute across replicas). One indexed aggregate query, not
        // a hot path — uploads are already rate-limited and infrequent
        // relative to reads.
        var usedBytes = await db.Assets
            .Where(a => a.WorkspaceId == workspaceId && a.DeletedAt == null)
            .SumAsync(a => (long?)a.SizeBytes, ct) ?? 0;
        var quotaBytes = (long)workspace.StorageQuotaMb * 1024 * 1024;
        if (usedBytes + originalBytes.Length > quotaBytes)
        {
            return TypedResults.Problem(
                title: "Storage quota exceeded",
                detail: $"This workspace has used {usedBytes} of {quotaBytes} bytes. Delete an asset, or upgrade the plan for more storage.",
                statusCode: StatusCodes.Status402PaymentRequired);
        }

        var sha256 = SHA256.HashData(originalBytes);

        // docs/adr/0012 Decision 3 step 4: an upload whose bytes exactly
        // match one already on record for this workspace short-circuits
        // onto the existing row rather than re-queuing processing —
        // ux_assets_workspace_sha256 is the same dedupe index SPEC 6.2's
        // own assets table already specifies.
        var existing = await db.Assets
            .Where(a => a.WorkspaceId == workspaceId && a.Sha256 == sha256 && a.DeletedAt == null)
            .Select(a => new { a.Id, a.Status, a.CreatedAt })
            .SingleOrDefaultAsync(ct);
        if (existing is not null)
        {
            return TypedResults.Accepted($"/api/v1/assets/{existing.Id}", new UploadAssetResponse(existing.Id, existing.Status, existing.CreatedAt));
        }

        var assetId = Guid.NewGuid();
        await storage.UploadOriginalAsync(workspaceId, assetId, originalBytes, ct);

        var asset = new Asset
        {
            Id = assetId,
            WorkspaceId = workspaceId,
            ProjectId = req.ProjectId,
            OriginalName = req.OriginalName,
            DeclaredMimeType = req.DeclaredMimeType,
            Status = AssetStatus.Pending,
            QuarantineBlobPath = $"{workspaceId}/{assetId}/original",
            Sha256 = sha256,
            SizeBytes = originalBytes.Length,
            RequestedByUserId = currentUser.UserId,
            CreatedAt = DateTimeOffset.UtcNow,
        };
        db.Assets.Add(asset);
        await db.SaveChangesAsync(ct);

        return TypedResults.Accepted($"/api/v1/assets/{asset.Id}", new UploadAssetResponse(asset.Id, asset.Status, asset.CreatedAt));
    }
}
