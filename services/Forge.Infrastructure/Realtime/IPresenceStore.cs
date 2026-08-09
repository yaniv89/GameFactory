namespace Forge.Infrastructure.Realtime;

/// <summary>One connected collaborator on one project, as tracked by <see cref="IPresenceStore"/>.</summary>
public sealed record PresenceEntry(string ConnectionId, Guid UserId, string DisplayName);

/// <summary>
/// Who is currently connected to a project's collaboration session.
/// CLAUDE.md Section 1.5 guardrail 18: "Session, presence, and rate-limit
/// state live in Redis or Postgres, never in process memory a load
/// balancer can't redistribute" — a SignalR hub instance only knows about
/// its own local connections, so with N hub replicas behind a load
/// balancer (guardrail 20), presence has to live somewhere every replica
/// can read and write, which the Redis backplane's own internal group
/// tracking doesn't expose a public query API for. This is that shared
/// store, deliberately separate from the SignalR Redis backplane itself
/// (which only relays messages/invocations across instances, not
/// "who's here" queries).
/// </summary>
public interface IPresenceStore
{
    /// <summary>Records that <paramref name="connectionId"/> joined <paramref name="projectId"/>'s session and returns the full roster afterward (including the new entry).</summary>
    Task<IReadOnlyList<PresenceEntry>> JoinAsync(Guid projectId, string connectionId, Guid userId, string displayName, CancellationToken ct);

    /// <summary>Records that <paramref name="connectionId"/> left <paramref name="projectId"/>'s session and returns the remaining roster.</summary>
    Task<IReadOnlyList<PresenceEntry>> LeaveAsync(Guid projectId, string connectionId, CancellationToken ct);

    Task<IReadOnlyList<PresenceEntry>> GetRosterAsync(Guid projectId, CancellationToken ct);
}
