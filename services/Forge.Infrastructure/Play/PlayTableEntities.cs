using Azure;
using Azure.Data.Tables;

namespace Forge.Infrastructure.Play;

/// <summary>
/// docs/SPEC.md Section 17's "Cloud saves: Azure Table Storage, 512 KB
/// cap, 5 slots, last-write-wins with a conflict prompt." One row per
/// (project, player, slot). <see cref="ITableEntity.ETag"/> is the
/// mechanism the "conflict prompt" half of that sentence rests on: a
/// write against an existing slot must carry the caller's last-known
/// ETag, and a mismatch means someone else (another device, a stale tab)
/// wrote in between — the server doesn't silently pick a winner, it
/// returns 409 with the current state so the runtime can show the
/// player a real choice.
/// </summary>
public sealed class SaveSlotTableEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "";
    public string RowKey { get; set; } = "";
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    public string DataBase64 { get; set; } = "";
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>
/// One ranked submission on a leaderboard. <see cref="RowKey"/> encodes
/// the score inverted (<c>long.MaxValue - score</c>, zero-padded) so
/// that Table Storage's own ascending-RowKey-within-partition order
/// yields descending score order for free — docs/SPEC.md Section 17's
/// "inverted row keys" called out by name. Exactly one live row per
/// player per leaderboard: <see cref="LeaderboardStore"/> replaces the
/// old row (via a same-partition transaction) whenever a better score
/// comes in, rather than accumulating every submission — "best score
/// wins," the conventional leaderboard default docs/SPEC.md doesn't
/// specify more precisely than "leaderboards."
/// </summary>
public sealed class LeaderboardEntryTableEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "";
    public string RowKey { get; set; } = "";
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    public string PlayerId { get; set; } = "";
    public long Score { get; set; }
    public DateTimeOffset SubmittedAt { get; set; }
}

/// <summary>
/// The small per-(leaderboard, player) index <see cref="LeaderboardStore"/>
/// keeps alongside <see cref="LeaderboardEntryTableEntity"/> so a new
/// submission can find (and atomically replace) that player's previous
/// ranked row without an unbounded scan — same partition as the entry
/// rows themselves (docs/SPEC.md's inverted-row-key scheme groups both
/// under <c>{projectId}_{leaderboardId}</c>), so both writes commit in
/// one Table Storage batch transaction.
/// </summary>
public sealed class LeaderboardPlayerBestTableEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "";
    public string RowKey { get; set; } = "";
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    /// <summary>The <see cref="LeaderboardEntryTableEntity.RowKey"/> of this player's current ranked row, so it can be deleted when replaced.</summary>
    public string EntryRowKey { get; set; } = "";
    public long Score { get; set; }
}

/// <summary>
/// docs/SPEC.md Section 17's "Achievements: server-validated where a rule
/// can be expressed, client-asserted otherwise." This MVP implements only
/// the client-asserted half — there's no rules engine yet to express a
/// server-checkable condition against, so <see cref="Verified"/> is
/// always <c>false</c>, the same explicit-not-fabricated posture
/// <c>PackageRankingCalculator</c> already applies to signals with no
/// real backing computation. One row per (project, player, achievement);
/// unlocking is idempotent — a second unlock call for an already-unlocked
/// achievement is a no-op, not an error, and never moves
/// <see cref="UnlockedAt"/>.
/// </summary>
public sealed class AchievementUnlockTableEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "";
    public string RowKey { get; set; } = "";
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    public DateTimeOffset UnlockedAt { get; set; }
    public bool Verified { get; set; }
}

/// <summary>
/// docs/SPEC.md Section 17's "Analytics: Table Storage into a daily
/// Parquet rollup." This MVP only ever writes this table — ingestion,
/// not the rollup job, which needs a whole separate Azure Functions
/// pipeline (M6 Phase 3's own gate-4 scanner and M6 Phase 3 follow-up's
/// timer trigger are the closest precedent in this codebase for what
/// that would look like, but building one is out of scope for this
/// phase's approved slice). No read/query endpoint exists yet either —
/// a stated follow-up, not a silently dropped requirement.
/// <see cref="PartitionKey"/> is day-bucketed (<c>{projectId}_{yyyyMMdd}</c>)
/// specifically so that eventual rollup job can page through exactly one
/// day at a time.
/// </summary>
public sealed class AnalyticsEventTableEntity : ITableEntity
{
    public string PartitionKey { get; set; } = "";
    public string RowKey { get; set; } = "";
    public DateTimeOffset? Timestamp { get; set; }
    public ETag ETag { get; set; }

    public string PlayerId { get; set; } = "";
    public string EventType { get; set; } = "";
    public string PayloadJson { get; set; } = "";
}
