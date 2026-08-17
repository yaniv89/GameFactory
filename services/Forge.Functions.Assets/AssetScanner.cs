using System.Data;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Functions.Assets;

/// <summary>One <see cref="Domain.Entities.Asset"/> claimed for processing, with its workspace id — the row's identity only; the actual bytes are a separate read (<see cref="Forge.Infrastructure.Storage.IAssetStorage.DownloadOriginalAsync"/>), same "claim is a narrow, fast statement" split <c>BuildScanner</c>/<c>PendingVersionScanner</c> already use.</summary>
public sealed record ClaimedAsset(Guid Id, Guid WorkspaceId);

/// <summary>
/// docs/adr/0012 Decision 4's claim/complete lifecycle against <c>assets</c>.
/// Mirrors <c>Forge.Functions.Build.BuildScanner</c> closely on purpose —
/// same claim shape (<c>FOR UPDATE SKIP LOCKED</c>, keeps N horizontally-
/// scaled worker instances from claiming the same row, CLAUDE.md
/// guardrail 20), same short-single-statement discipline (no long-held
/// transaction spans the actual decode, guardrail 21). Same known, stated
/// gap too: a claimed row whose worker instance crashes before ever
/// calling <see cref="MarkReadyAsync"/>/<see cref="MarkFailedAsync"/>/
/// <see cref="RequeueAsync"/> stays <see cref="AssetStatus.Processing"/>
/// forever — no reclaim-after-timeout sweep exists yet, real but out of
/// this phase's scope, same as <c>BuildScanner</c>'s own documented gap.
/// </summary>
public sealed class AssetScanner(ForgeDbContext db)
{
    public async Task<ClaimedAsset?> ClaimNextAsync(CancellationToken ct)
    {
        var connection = db.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open)
        {
            await connection.OpenAsync(ct);
        }

        using var command = connection.CreateCommand();
        command.CommandText =
            """
            UPDATE assets
            SET status = @processing
            WHERE id = (
                SELECT id FROM assets
                WHERE status = @pending
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, workspace_id
            """;
        AddParameter(command, "pending", AssetStatus.Pending);
        AddParameter(command, "processing", AssetStatus.Processing);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return new ClaimedAsset(reader.GetGuid(0), reader.GetGuid(1));
    }

    private static void AddParameter(IDbCommand command, string name, string value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }

    public Task MarkReadyAsync(Guid assetId, string processedBlobPath, int width, int height, CancellationToken ct) =>
        db.Assets.Where(a => a.Id == assetId).ExecuteUpdateAsync(s => s
            .SetProperty(a => a.Status, AssetStatus.Ready)
            .SetProperty(a => a.ProcessedBlobPath, processedBlobPath)
            .SetProperty(a => a.Width, width)
            .SetProperty(a => a.Height, height)
            .SetProperty(a => a.CompletedAt, DateTimeOffset.UtcNow), ct);

    /// <summary>A real, attributable processing failure (<see cref="AssetProcessingFailedException"/>) — the file itself is the reason, not this worker's environment.</summary>
    public Task MarkFailedAsync(Guid assetId, string errorMessage, CancellationToken ct) =>
        db.Assets.Where(a => a.Id == assetId).ExecuteUpdateAsync(s => s
            .SetProperty(a => a.Status, AssetStatus.Failed)
            .SetProperty(a => a.ErrorMessage, errorMessage)
            .SetProperty(a => a.CompletedAt, DateTimeOffset.UtcNow), ct);

    /// <summary>A harness failure (<see cref="AssetHarnessException"/>) — an infra/environment problem this worker instance hit, not a verdict on the file. Reverts to <see cref="AssetStatus.Pending"/> so a later tick (this instance or another) retries it, rather than permanently branding a fine asset <see cref="AssetStatus.Failed"/>.</summary>
    public Task RequeueAsync(Guid assetId, CancellationToken ct) =>
        db.Assets.Where(a => a.Id == assetId).ExecuteUpdateAsync(s => s.SetProperty(a => a.Status, AssetStatus.Pending), ct);
}
