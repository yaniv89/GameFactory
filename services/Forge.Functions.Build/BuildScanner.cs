using System.Data;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Functions.Build;

/// <summary>One <see cref="Domain.Entities.Build"/> claimed for building, with the committed revision id it needs to build from — the row's identity only; the actual document is a separate read (<see cref="BuildScanner.GetRevisionDocumentAsync"/>), same "claim is a narrow, fast statement" split <c>PendingVersionScanner</c> uses for gate 4.</summary>
public sealed record ClaimedBuild(Guid Id, Guid ProjectId, long RevisionId);

/// <summary>
/// docs/adr/0010 Decision 4's claim/complete lifecycle against
/// <c>builds</c>. Mirrors <c>Forge.Functions.Scan.PendingVersionScanner</c>
/// closely on purpose — same claim shape (<c>FOR UPDATE SKIP LOCKED</c>,
/// keeps N horizontally-scaled worker instances from claiming the same
/// row, CLAUDE.md guardrail 20), same short-single-statement discipline
/// (no long-held transaction spans the actual build itself, which can
/// take up to <see cref="BuildRunnerOptions.TimeoutSeconds"/>, guardrail
/// 21). Same known, stated gap too: a claimed row whose worker instance
/// crashes before ever calling <see cref="MarkReadyAsync"/>/
/// <see cref="MarkFailedAsync"/>/<see cref="RequeueAsync"/> stays
/// <c>Building</c> forever — no reclaim-after-timeout sweep exists yet,
/// real but out of this phase's scope.
/// </summary>
public sealed class BuildScanner(ForgeDbContext db)
{
    public async Task<ClaimedBuild?> ClaimNextAsync(CancellationToken ct)
    {
        var connection = db.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open)
        {
            await connection.OpenAsync(ct);
        }

        using var command = connection.CreateCommand();
        command.CommandText =
            """
            UPDATE builds
            SET status = @building
            WHERE id = (
                SELECT id FROM builds
                WHERE status = @queued
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, project_id, revision_id
            """;
        AddParameter(command, "queued", BuildStatus.Queued);
        AddParameter(command, "building", BuildStatus.Building);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return new ClaimedBuild(reader.GetGuid(0), reader.GetGuid(1), reader.GetInt64(2));
    }

    private static void AddParameter(IDbCommand command, string name, string value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }

    /// <summary>The actual build input — <c>project_revisions.doc</c> for the claimed row's <see cref="ClaimedBuild.RevisionId"/>, the exact <c>ProjectDocument</c> JSON the editor committed (docs/adr/0009), unmodified.</summary>
    public Task<System.Text.Json.JsonElement> GetRevisionDocumentAsync(long revisionId, CancellationToken ct) =>
        db.ProjectRevisions.Where(r => r.Id == revisionId).Select(r => r.Doc).SingleAsync(ct);

    public Task MarkReadyAsync(Guid buildId, string bundleBlobPath, byte[] bundleSha256, long sizeBytes, string inlineScriptSha256Base64, string inlineStyleSha256Base64, CancellationToken ct) =>
        db.Builds.Where(b => b.Id == buildId).ExecuteUpdateAsync(s => s
            .SetProperty(b => b.Status, BuildStatus.Ready)
            .SetProperty(b => b.BundleBlobPath, bundleBlobPath)
            .SetProperty(b => b.BundleSha256, bundleSha256)
            .SetProperty(b => b.SizeBytes, sizeBytes)
            .SetProperty(b => b.InlineScriptSha256Base64, inlineScriptSha256Base64)
            .SetProperty(b => b.InlineStyleSha256Base64, inlineStyleSha256Base64)
            .SetProperty(b => b.CompletedAt, DateTimeOffset.UtcNow), ct);

    /// <summary>A real, attributable build failure (<see cref="BuildFailedException"/>) — the project's document or its installed modules are the reason, not this worker's environment.</summary>
    public Task MarkFailedAsync(Guid buildId, string errorMessage, CancellationToken ct) =>
        db.Builds.Where(b => b.Id == buildId).ExecuteUpdateAsync(s => s
            .SetProperty(b => b.Status, BuildStatus.Failed)
            .SetProperty(b => b.ErrorMessage, errorMessage)
            .SetProperty(b => b.CompletedAt, DateTimeOffset.UtcNow), ct);

    /// <summary>A harness failure (<see cref="BuildHarnessException"/>) — an infra/environment problem this worker instance hit, not a verdict on the project. Reverts to <see cref="BuildStatus.Queued"/> so a later tick (this instance or another) retries it, rather than permanently branding a fine project <see cref="BuildStatus.Failed"/>.</summary>
    public Task RequeueAsync(Guid buildId, CancellationToken ct) =>
        db.Builds.Where(b => b.Id == buildId).ExecuteUpdateAsync(s => s.SetProperty(b => b.Status, BuildStatus.Queued), ct);
}
