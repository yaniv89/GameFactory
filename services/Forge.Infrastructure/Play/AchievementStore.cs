using Azure;
using Azure.Data.Tables;

namespace Forge.Infrastructure.Play;

public sealed class AchievementStore
{
    private const string TableName = "PlayAchievements";

    private readonly TableClient _table;

    public AchievementStore(TableServiceClient serviceClient)
    {
        _table = serviceClient.GetTableClient(TableName);
        _table.CreateIfNotExists();
    }

    /// <summary>Idempotent — an already-unlocked achievement keeps its original <see cref="AchievementUnlockTableEntity.UnlockedAt"/> rather than being overwritten.</summary>
    public async Task<AchievementUnlockTableEntity> UnlockAsync(Guid projectId, Guid playerId, string achievementId, CancellationToken ct)
    {
        var partitionKey = PlayTableKeys.ProjectPlayer(projectId, playerId);

        try
        {
            var existing = await _table.GetEntityAsync<AchievementUnlockTableEntity>(partitionKey, achievementId, cancellationToken: ct);
            return existing.Value;
        }
        catch (RequestFailedException e) when (e.Status == 404)
        {
            var entity = new AchievementUnlockTableEntity
            {
                PartitionKey = partitionKey,
                RowKey = achievementId,
                UnlockedAt = DateTimeOffset.UtcNow,
                Verified = false, // See this entity's own doc comment — no rules engine exists yet.
            };

            try
            {
                await _table.AddEntityAsync(entity, ct);
                return entity;
            }
            catch (RequestFailedException addFailure) when (addFailure.Status == 409)
            {
                // Lost a race against a concurrent unlock call for the
                // same achievement — the other call's row is now the
                // real one; idempotency means returning it, not failing.
                var winner = await _table.GetEntityAsync<AchievementUnlockTableEntity>(partitionKey, achievementId, cancellationToken: ct);
                return winner.Value;
            }
        }
    }

    public async Task<IReadOnlyList<AchievementUnlockTableEntity>> ListUnlockedAsync(Guid projectId, Guid playerId, CancellationToken ct)
    {
        var partitionKey = PlayTableKeys.ProjectPlayer(projectId, playerId);
        var results = new List<AchievementUnlockTableEntity>();
        await foreach (var entity in _table.QueryAsync<AchievementUnlockTableEntity>(e => e.PartitionKey == partitionKey, cancellationToken: ct))
        {
            results.Add(entity);
        }
        return results;
    }
}
