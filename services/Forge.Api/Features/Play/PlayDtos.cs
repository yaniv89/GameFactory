namespace Forge.Api.Features.Play;

public sealed record PlayIdentityResponse(Guid PlayerId, string PlayToken);

public sealed record LinkPlayIdentityRequest(string PlayToken);

public sealed record SaveSlotResponse(int Slot, string? DataBase64, DateTimeOffset? UpdatedAt, string? ETag);

public sealed record SaveSlotListResponse(IReadOnlyList<SaveSlotResponse> Slots);

public sealed record PutSaveSlotRequest(string DataBase64, string? ExpectedETag);

public sealed record LeaderboardEntryResponse(Guid PlayerId, long Score, DateTimeOffset SubmittedAt);

public sealed record LeaderboardResponse(bool Verified, IReadOnlyList<LeaderboardEntryResponse> Entries);

public sealed record SubmitScoreRequest(long Score);

public sealed record AchievementUnlockResponse(string AchievementId, DateTimeOffset UnlockedAt, bool Verified);

public sealed record AchievementListResponse(IReadOnlyList<AchievementUnlockResponse> Achievements);

public sealed record AnalyticsEventRequest(string EventType, string? PayloadJson);

public sealed record IngestAnalyticsEventsRequest(IReadOnlyList<AnalyticsEventRequest> Events);
