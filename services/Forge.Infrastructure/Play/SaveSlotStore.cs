using Azure;
using Azure.Data.Tables;

namespace Forge.Infrastructure.Play;

public enum PutSlotOutcome
{
    Created,
    Updated,
    /// <summary>The caller's <c>expectedETag</c> didn't match the slot's current one — someone else wrote in between. <see cref="PutSlotResult.Current"/> carries what's actually there now so the runtime can show a real conflict prompt (docs/SPEC.md Section 17).</summary>
    Conflict,
}

public sealed record PutSlotResult(PutSlotOutcome Outcome, SaveSlotTableEntity? Current);

/// <summary>docs/SPEC.md Section 17's cloud saves: 5 slots (0-4), 512 KB cap enforced by the caller (<c>SavesEndpoint</c>) before this store ever sees the payload, last-write-wins with an ETag-checked conflict prompt.</summary>
public sealed class SaveSlotStore
{
    public const int SlotCount = 5;
    private const string TableName = "PlaySaves";

    private readonly TableClient _table;

    public SaveSlotStore(TableServiceClient serviceClient)
    {
        _table = serviceClient.GetTableClient(TableName);
        _table.CreateIfNotExists();
    }

    public async Task<SaveSlotTableEntity?> GetSlotAsync(Guid projectId, Guid playerId, int slot, CancellationToken ct)
    {
        try
        {
            var response = await _table.GetEntityAsync<SaveSlotTableEntity>(
                PlayTableKeys.ProjectPlayer(projectId, playerId), slot.ToString(), cancellationToken: ct);
            return response.Value;
        }
        catch (RequestFailedException e) when (e.Status == 404)
        {
            return null;
        }
    }

    public async Task<IReadOnlyList<SaveSlotTableEntity>> ListSlotsAsync(Guid projectId, Guid playerId, CancellationToken ct)
    {
        var partitionKey = PlayTableKeys.ProjectPlayer(projectId, playerId);
        var results = new List<SaveSlotTableEntity>();
        await foreach (var entity in _table.QueryAsync<SaveSlotTableEntity>(e => e.PartitionKey == partitionKey, cancellationToken: ct))
        {
            results.Add(entity);
        }
        return results;
    }

    public async Task<PutSlotResult> PutSlotAsync(Guid projectId, Guid playerId, int slot, string dataBase64, string? expectedETag, CancellationToken ct)
    {
        var partitionKey = PlayTableKeys.ProjectPlayer(projectId, playerId);
        var rowKey = slot.ToString();

        var existing = await GetSlotAsync(projectId, playerId, slot, ct);
        var entity = new SaveSlotTableEntity
        {
            PartitionKey = partitionKey,
            RowKey = rowKey,
            DataBase64 = dataBase64,
            UpdatedAt = DateTimeOffset.UtcNow,
        };

        if (existing is null)
        {
            // A brand-new slot has nothing to conflict with — any
            // expectedETag the client sent for a slot it never actually
            // read from the server is meaningless here, not an error.
            await _table.AddEntityAsync(entity, ct);
            return new PutSlotResult(PutSlotOutcome.Created, null);
        }

        if (expectedETag is null || existing.ETag.ToString() != expectedETag)
        {
            return new PutSlotResult(PutSlotOutcome.Conflict, existing);
        }

        await _table.UpdateEntityAsync(entity, existing.ETag, TableUpdateMode.Replace, ct);
        return new PutSlotResult(PutSlotOutcome.Updated, null);
    }

    /// <summary>Idempotent — clearing an already-empty slot is a no-op, not a 404.</summary>
    public async Task DeleteSlotAsync(Guid projectId, Guid playerId, int slot, CancellationToken ct)
    {
        try
        {
            await _table.DeleteEntityAsync(PlayTableKeys.ProjectPlayer(projectId, playerId), slot.ToString(), cancellationToken: ct);
        }
        catch (RequestFailedException e) when (e.Status == 404)
        {
        }
    }
}
