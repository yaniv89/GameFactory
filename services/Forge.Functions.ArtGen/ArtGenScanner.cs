using System.Data;
using Forge.Domain.Entities;
using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Forge.Functions.ArtGen;

/// <summary>One <see cref="GenerationRequest"/> claimed for processing — the row's identity and the fields <see cref="ArtGenRunner"/> actually needs (<see cref="ExpandedPrompt"/>, <see cref="Category"/>), same "claim is a narrow, fast statement" split <c>AssetScanner</c>/<c>BuildScanner</c> already use.</summary>
public sealed record ClaimedGenerationRequest(Guid Id, Guid WorkspaceId, string ExpandedPrompt, string Category);

/// <summary>One successfully processed variation, ready to record against a <see cref="GenerationRequest"/> — the blob path <see cref="ArtGenOrchestrator"/> already uploaded to, plus the real dimensions <c>AssetRunner</c> decoded.</summary>
/// <summary>
/// N8: <see cref="VariationId"/> must be the exact id
/// <see cref="ArtGenOrchestrator"/> already used to build
/// <see cref="ProcessedBlobPath"/> and to actually upload the bytes
/// there (<c>IArtGenerationStorage.UploadVariationAsync</c>'s own third
/// parameter) — <see cref="ArtGenScanner.MarkReadyAsync"/> must give the
/// inserted <see cref="GenerationVariation"/> row that same id, not a
/// freshly generated one, or the row's own primary key silently stops
/// matching the blob it's supposed to point at. Found by N8's own
/// full-chain exit-criteria test: every prior test either read
/// <see cref="GenerationVariation.ProcessedBlobPath"/> back verbatim
/// (never re-deriving a path from <c>Id</c>, so the mismatch was
/// invisible) or seeded a fixture where both values came from the same
/// local variable by construction. A real "Describe It" run would have
/// hit this on every single generation: Ready with a real variation,
/// then a 404 fetching its own thumbnail.
/// </summary>
public sealed record CompletedVariation(Guid VariationId, string ProcessedBlobPath, int Width, int Height);

/// <summary>
/// docs/adr/0016 Decision 6's claim/complete lifecycle against
/// <c>generation_requests</c>. Mirrors <c>Forge.Functions.Assets.AssetScanner</c>
/// closely on purpose — same claim shape (<c>FOR UPDATE SKIP LOCKED</c>,
/// keeps N horizontally-scaled worker instances from claiming the same
/// row, CLAUDE.md guardrail 20), same short-single-statement discipline
/// (no long-held transaction spans the actual Gemini call, guardrail 21).
/// Same known, stated gap too: a claimed row whose worker instance
/// crashes before ever calling one of the Mark*Async methods stays
/// <see cref="GenerationStatus.Generating"/> forever — no
/// reclaim-after-timeout sweep exists yet, real but out of this phase's
/// scope, same as <c>AssetScanner</c>'s own documented gap.
/// </summary>
public sealed class ArtGenScanner(ForgeDbContext db)
{
    public async Task<ClaimedGenerationRequest?> ClaimNextAsync(CancellationToken ct)
    {
        var connection = db.Database.GetDbConnection();
        if (connection.State != ConnectionState.Open)
        {
            await connection.OpenAsync(ct);
        }

        using var command = connection.CreateCommand();
        command.CommandText =
            """
            UPDATE generation_requests
            SET status = @generating
            WHERE id = (
                SELECT id FROM generation_requests
                WHERE status = @queued
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, workspace_id, expanded_prompt, category
            """;
        AddParameter(command, "queued", GenerationStatus.Queued);
        AddParameter(command, "generating", GenerationStatus.Generating);

        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        // expanded_prompt is nullable at the schema level (a Declined/
        // Failed row from CreateGenerationRequestEndpoint never gets
        // one), but a row that reached Queued only got there through
        // ConfirmGenerationRequestEndpoint, which itself only accepts an
        // AwaitingConfirmation row -- and AwaitingConfirmation is set
        // only alongside a real ExpandedPrompt (CreateGenerationRequestEndpoint's
        // own Status/ExpandedPrompt assignment, docs/adr/0016 Decision
        // 6). A null here is a genuine data-integrity violation of that
        // invariant, not a case to paper over with a fallback string.
        var expandedPrompt = reader.IsDBNull(2)
            ? throw new InvalidOperationException($"Generation request '{reader.GetGuid(0)}' reached Queued with no ExpandedPrompt.")
            : reader.GetString(2);

        return new ClaimedGenerationRequest(reader.GetGuid(0), reader.GetGuid(1), expandedPrompt, reader.GetString(3));
    }

    private static void AddParameter(IDbCommand command, string name, string value)
    {
        var parameter = command.CreateParameter();
        parameter.ParameterName = name;
        parameter.Value = value;
        command.Parameters.Add(parameter);
    }

    public async Task MarkReadyAsync(Guid requestId, IReadOnlyList<CompletedVariation> variations, CancellationToken ct)
    {
        foreach (var variation in variations)
        {
            db.GenerationVariations.Add(new GenerationVariation
            {
                Id = variation.VariationId,
                GenerationRequestId = requestId,
                ProcessedBlobPath = variation.ProcessedBlobPath,
                Width = variation.Width,
                Height = variation.Height,
                CreatedAt = DateTimeOffset.UtcNow,
            });
        }
        await db.SaveChangesAsync(ct);

        await db.GenerationRequests.Where(g => g.Id == requestId).ExecuteUpdateAsync(s => s
            .SetProperty(g => g.Status, GenerationStatus.Ready)
            .SetProperty(g => g.CompletedAt, DateTimeOffset.UtcNow), ct);
    }

    /// <summary>A real, attributable processing failure — the generated bytes themselves (or the call that produced them) are the reason, not this worker's environment.</summary>
    public Task MarkFailedAsync(Guid requestId, string errorMessage, CancellationToken ct) =>
        db.GenerationRequests.Where(g => g.Id == requestId).ExecuteUpdateAsync(s => s
            .SetProperty(g => g.Status, GenerationStatus.Failed)
            .SetProperty(g => g.ErrorMessage, errorMessage)
            .SetProperty(g => g.CompletedAt, DateTimeOffset.UtcNow), ct);

    /// <summary>Gemini's own safety filtering refused the *image* generation call specifically (distinct from a Declined expansion, which never reaches Queued at all) — docs/adr/0016 Decision 6's Declined/Failed split, applied a second time at this later stage.</summary>
    public Task MarkDeclinedAsync(Guid requestId, string reason, CancellationToken ct) =>
        db.GenerationRequests.Where(g => g.Id == requestId).ExecuteUpdateAsync(s => s
            .SetProperty(g => g.Status, GenerationStatus.Declined)
            .SetProperty(g => g.ErrorMessage, reason)
            .SetProperty(g => g.CompletedAt, DateTimeOffset.UtcNow), ct);

    /// <summary>A harness failure — an infra/environment problem this worker instance hit, not a verdict on the request. Reverts to <see cref="GenerationStatus.Queued"/> so a later tick (this instance or another) retries it.</summary>
    public Task RequeueAsync(Guid requestId, CancellationToken ct) =>
        db.GenerationRequests.Where(g => g.Id == requestId).ExecuteUpdateAsync(s => s.SetProperty(g => g.Status, GenerationStatus.Queued), ct);
}
