using Azure.Data.Tables;

namespace Forge.Infrastructure.Play;

/// <summary>Ingestion only — see <see cref="AnalyticsEventTableEntity"/>'s own doc comment on the daily-Parquet-rollup job this store deliberately doesn't build yet.</summary>
public sealed class AnalyticsEventStore
{
    private const string TableName = "PlayAnalyticsEvents";

    /// <summary>Table Storage's own batch-transaction ceiling — also this store's per-request ingestion cap, enforced by the endpoint before any event reaches here.</summary>
    public const int MaxEventsPerBatch = 100;

    private readonly TableClient _table;

    public AnalyticsEventStore(TableServiceClient serviceClient)
    {
        _table = serviceClient.GetTableClient(TableName);
        _table.CreateIfNotExists();
    }

    public async Task IngestAsync(Guid projectId, Guid playerId, IReadOnlyList<(string EventType, string PayloadJson)> events, CancellationToken ct)
    {
        if (events.Count == 0) return;

        var now = DateTimeOffset.UtcNow;
        var partitionKey = PlayTableKeys.DayBucket(projectId, now);

        // Reverse-ticks row key: newest event sorts first within the day
        // partition, the natural order an eventual rollup/inspection tool
        // would want to page through. A trailing guid keeps two events
        // landing in the same tick from colliding.
        var actions = events.Select(e => new TableTransactionAction(
            TableTransactionActionType.Add,
            new AnalyticsEventTableEntity
            {
                PartitionKey = partitionKey,
                RowKey = $"{unchecked(DateTime.MaxValue.Ticks - now.UtcTicks):D19}_{Guid.NewGuid():N}",
                PlayerId = playerId.ToString(),
                EventType = e.EventType,
                PayloadJson = e.PayloadJson,
            }));

        await _table.SubmitTransactionAsync(actions, ct);
    }
}
