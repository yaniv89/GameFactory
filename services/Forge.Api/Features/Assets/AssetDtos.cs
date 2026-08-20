namespace Forge.Api.Features.Assets;

public sealed record UploadAssetRequest(string OriginalName, string DeclaredMimeType, string ContentBase64, Guid? ProjectId);

public sealed record UploadAssetResponse(Guid Id, string Status, DateTimeOffset CreatedAt);

public sealed record AssetSummaryResponse(
    Guid Id,
    Guid? ProjectId,
    string OriginalName,
    string Status,
    long SizeBytes,
    int? Width,
    int? Height,
    string? ErrorMessage,
    DateTimeOffset CreatedAt,
    DateTimeOffset? CompletedAt);

public sealed record AssetListResponse(IReadOnlyList<AssetSummaryResponse> Assets);
