using System.Text.Json;
using StackExchange.Redis;

namespace Forge.Infrastructure.Realtime;

/// <summary>
/// One Redis hash per project (<c>presence:{projectId}</c>), field =
/// connection id, value = the rest of <see cref="PresenceEntry"/> as JSON.
/// A hash, not a set of JSON blobs or a per-connection key: it makes
/// "give me the whole roster" one HGETALL instead of a SCAN, and cleanup
/// on disconnect is a single HDEL. Reuses the same <see cref="IConnectionMultiplexer"/>
/// singleton <c>AddForgeRateLimiting</c> already registers for the whole
/// process (that method's own doc comment on why one shared multiplexer,
/// not a new connection per feature) — this store does not open its own.
///
/// No TTL on hash fields: a graceful disconnect (tab close, navigation,
/// network drop past the SignalR keep-alive timeout) reliably fires
/// <c>OnDisconnectedAsync</c>, which is where cleanup actually happens
/// (see <c>Forge.Api.Features.Collab.CollabHub</c>). An ungraceful loss
/// (hub process killed mid-connection) can leave a stale entry until that
/// connection's own reconnect/timeout path runs; a documented, accepted
/// gap for M7 Phase 1, not a silent one — a TTL-based safety net is
/// tracked as follow-up work, not required for the exit criterion this
/// phase serves (SignalR client reconnection with group/presence intact,
/// docs/SPEC.md Section 18.4).
/// </summary>
public sealed class RedisPresenceStore(IConnectionMultiplexer redis) : IPresenceStore
{
    private static string RosterKey(Guid projectId) => $"presence:{projectId}";

    public async Task<IReadOnlyList<PresenceEntry>> JoinAsync(Guid projectId, string connectionId, Guid userId, string displayName, CancellationToken ct)
    {
        var db = redis.GetDatabase();
        var value = JsonSerializer.Serialize(new StoredPresence(userId, displayName));
        await db.HashSetAsync(RosterKey(projectId), connectionId, value);
        return await GetRosterAsync(projectId, ct);
    }

    public async Task<IReadOnlyList<PresenceEntry>> LeaveAsync(Guid projectId, string connectionId, CancellationToken ct)
    {
        var db = redis.GetDatabase();
        await db.HashDeleteAsync(RosterKey(projectId), connectionId);
        return await GetRosterAsync(projectId, ct);
    }

    public async Task<IReadOnlyList<PresenceEntry>> GetRosterAsync(Guid projectId, CancellationToken ct)
    {
        var db = redis.GetDatabase();
        var fields = await db.HashGetAllAsync(RosterKey(projectId));
        var roster = new List<PresenceEntry>(fields.Length);
        foreach (var field in fields)
        {
            var stored = JsonSerializer.Deserialize<StoredPresence>(field.Value.ToString());
            if (stored is null) continue;
            roster.Add(new PresenceEntry(field.Name.ToString(), stored.UserId, stored.DisplayName));
        }
        return roster;
    }

    private sealed record StoredPresence(Guid UserId, string DisplayName);
}
