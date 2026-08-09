using Azure;
using Azure.Data.Tables;

namespace Forge.Infrastructure.Play;

/// <summary>
/// docs/SPEC.md Section 17's leaderboards, plus its own anti-cheat
/// warning: "leaderboards from a browser game cannot be trusted... label
/// unverified boards as unverified in the default UI." This store never
/// marks anything verified — there's no rate-limit-plus-outlier-flagging
/// or replay-verification pipeline yet (both listed as real mitigations
/// in the SPEC, neither built this phase) — <c>LeaderboardsEndpoint</c>
/// reports every read as <c>verified: false</c> for exactly that reason,
/// not because this store forgot to compute it.
/// </summary>
public sealed class LeaderboardStore
{
    private const string TableName = "PlayLeaderboardEntries";

    /// <summary>Windowed views (this-week / this-month leaderboards) aren't implemented yet — every read is all-time. A stated follow-up, not a silently dropped SPEC requirement.</summary>
    public const int MaxTopEntries = 100;

    private readonly TableClient _table;

    public LeaderboardStore(TableServiceClient serviceClient)
    {
        _table = serviceClient.GetTableClient(TableName);
        _table.CreateIfNotExists();
    }

    /// <summary>
    /// No-ops if <paramref name="score"/> doesn't beat the player's
    /// existing best. Otherwise atomically (same-partition batch
    /// transaction) drops their old ranked row and writes the new one
    /// plus the small best-score index <see cref="LeaderboardPlayerBestTableEntity"/>
    /// tracks it under.
    /// </summary>
    public async Task SubmitScoreAsync(Guid projectId, string leaderboardId, Guid playerId, long score, CancellationToken ct)
    {
        var partitionKey = PlayTableKeys.ProjectScoped(projectId, leaderboardId);
        var bestRowKey = PlayTableKeys.PlayerBestRowKey(playerId);

        LeaderboardPlayerBestTableEntity? existingBest;
        try
        {
            existingBest = (await _table.GetEntityAsync<LeaderboardPlayerBestTableEntity>(partitionKey, bestRowKey, cancellationToken: ct)).Value;
        }
        catch (RequestFailedException e) when (e.Status == 404)
        {
            existingBest = null;
        }

        if (existingBest is not null && existingBest.Score >= score) return;

        var newEntryRowKey = PlayTableKeys.InvertedScoreRowKey(score, playerId);
        var now = DateTimeOffset.UtcNow;

        var actions = new List<TableTransactionAction>();
        if (existingBest is not null)
        {
            actions.Add(new TableTransactionAction(
                TableTransactionActionType.Delete,
                new TableEntity(partitionKey, existingBest.EntryRowKey)));
        }
        actions.Add(new TableTransactionAction(
            TableTransactionActionType.UpsertReplace,
            new LeaderboardEntryTableEntity
            {
                PartitionKey = partitionKey,
                RowKey = newEntryRowKey,
                PlayerId = playerId.ToString(),
                Score = score,
                SubmittedAt = now,
            }));
        actions.Add(new TableTransactionAction(
            TableTransactionActionType.UpsertReplace,
            new LeaderboardPlayerBestTableEntity
            {
                PartitionKey = partitionKey,
                RowKey = bestRowKey,
                EntryRowKey = newEntryRowKey,
                Score = score,
            }));

        await _table.SubmitTransactionAsync(actions, ct);
    }

    /// <summary>
    /// Top <paramref name="limit"/> entries, best score first — the
    /// natural order Table Storage returns a partition query in, thanks
    /// to the inverted RowKey scheme. Bounded by <paramref name="limit"/>
    /// (capped at <see cref="MaxTopEntries"/>): this only ever pages as
    /// many rows off the server as the caller actually asked for.
    ///
    /// Uses a raw OData filter rather than the LINQ-expression overload
    /// specifically so it can exclude <see cref="LeaderboardPlayerBestTableEntity"/>'s
    /// own index rows, which deliberately live in this same partition
    /// (so a score submission's delete-old/insert-new/update-index can
    /// commit as one same-partition transaction) — without the
    /// <c>RowKey lt 'a'</c> bound, an index row (RowKey prefixed
    /// <c>best_</c>) would deserialize into this method's own entity
    /// shape with a blank PlayerId once every real numeric-prefixed
    /// RowKey (digits always sort before letters) is exhausted, quietly
    /// padding a short leaderboard with phantom entries.
    /// </summary>
    public async Task<IReadOnlyList<LeaderboardEntryTableEntity>> GetTopAsync(Guid projectId, string leaderboardId, int limit, CancellationToken ct)
    {
        var partitionKey = PlayTableKeys.ProjectScoped(projectId, leaderboardId);
        var boundedLimit = Math.Min(limit, MaxTopEntries);
        var results = new List<LeaderboardEntryTableEntity>(boundedLimit);

        var filter = $"PartitionKey eq '{partitionKey}' and RowKey lt 'a'";
        await foreach (var entity in _table.QueryAsync<LeaderboardEntryTableEntity>(filter, maxPerPage: boundedLimit, cancellationToken: ct))
        {
            results.Add(entity);
            if (results.Count >= boundedLimit) break;
        }

        return results;
    }
}
