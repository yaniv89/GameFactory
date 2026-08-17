namespace Forge.Api.Features.Registry;

public sealed record UpsertReviewRequest(int Rating, string? Body);

public sealed record ReviewResponse(Guid Id, Guid? UserId, int Rating, string? Body, DateTimeOffset CreatedAt, DateTimeOffset? UpdatedAt);

public sealed record ReviewListResponse(IReadOnlyList<ReviewResponse> Reviews, string? NextCursor, double? AverageRating, int ReviewCount);
