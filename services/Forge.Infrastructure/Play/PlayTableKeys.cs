using System.Text.RegularExpressions;

namespace Forge.Infrastructure.Play;

/// <summary>
/// Shared PartitionKey/RowKey construction for every Play Services table
/// (<see cref="SaveSlotStore"/>, <see cref="LeaderboardStore"/>,
/// <see cref="AchievementStore"/>, <see cref="AnalyticsEventStore"/>) —
/// centralized so the escaping/validation rule is written once. Table
/// Storage forbids <c>/</c>, <c>\</c>, <c>#</c>, <c>?</c>, and control
/// characters in both keys; <see cref="Guid"/> segments are always safe
/// by construction, but <paramref name="id"/> segments in
/// <see cref="RequireSafeId"/> come from a creator's own manifest
/// (leaderboard/achievement ids) and must be checked before ever
/// reaching a Table Storage call.
/// </summary>
public static partial class PlayTableKeys
{
    public static string ProjectPlayer(Guid projectId, Guid playerId) => $"{projectId:N}_{playerId:N}";

    public static string ProjectScoped(Guid projectId, string id) => $"{projectId:N}_{id}";

    public static string DayBucket(Guid projectId, DateTimeOffset at) => $"{projectId:N}_{at:yyyyMMdd}";

    /// <summary>Inverts the score so ascending RowKey order (Table Storage's only native order) yields descending score order — docs/SPEC.md Section 17's "inverted row keys." Offset by <see cref="long.MaxValue"/> so negative scores still sort correctly relative to positive ones.</summary>
    public static string InvertedScoreRowKey(long score, Guid playerId) =>
        $"{unchecked(long.MaxValue - score):D19}_{playerId:N}";

    public static string PlayerBestRowKey(Guid playerId) => $"best_{playerId:N}";

    public static bool IsSafeId(string id) => id.Length is > 0 and <= 128 && SafeIdPattern().IsMatch(id);

    [GeneratedRegex("^[A-Za-z0-9_.-]+$")]
    private static partial Regex SafeIdPattern();
}
