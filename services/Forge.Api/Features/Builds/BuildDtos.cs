namespace Forge.Api.Features.Builds;

public sealed record CreateBuildResponse(Guid Id, string Status, DateTimeOffset CreatedAt);

/// <summary>
/// <see cref="PlayUrl"/> is set only once <see cref="Status"/> reaches
/// <c>ready</c> (docs/adr/0010 Decision 5 — <c>Forge.Play</c>, C4).
/// <see cref="ErrorMessage"/> is set only on <c>failed</c>.
/// </summary>
public sealed record BuildStatusResponse(
    Guid Id,
    long RevisionId,
    string Status,
    string? PlayUrl,
    string? ErrorMessage,
    long? SizeBytes,
    DateTimeOffset CreatedAt,
    DateTimeOffset? CompletedAt);

public sealed record BuildSummaryResponse(Guid Id, long RevisionId, string Status, DateTimeOffset CreatedAt, DateTimeOffset? CompletedAt);

public sealed record BuildListResponse(IReadOnlyList<BuildSummaryResponse> Builds);
