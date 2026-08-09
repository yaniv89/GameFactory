using System.Text.Json;

namespace Forge.Api.Features.Registry;

public sealed record PackageSummaryResponse(
    Guid Id,
    string Name,
    string Kind,
    string DisplayName,
    string Summary,
    string LicenseSpdx,
    bool IsDeprecated,
    DateTimeOffset CreatedAt,
    string? LatestVersion);

public sealed record PackageListResponse(
    IReadOnlyList<PackageSummaryResponse> Packages,
    string? NextCursor);

public sealed record PackageDetailResponse(
    Guid Id,
    string Name,
    string Kind,
    Guid AuthorUserId,
    string DisplayName,
    string Summary,
    string? ReadmeMarkdown,
    string? HomepageUrl,
    string LicenseSpdx,
    bool IsDeprecated,
    DateTimeOffset CreatedAt);

public sealed record PackageVersionSummaryResponse(
    Guid Id,
    string Version,
    string EngineRange,
    string ScanStatus,
    int SizeBytes,
    DateTimeOffset PublishedAt,
    DateTimeOffset? YankedAt);

public sealed record PackageVersionListResponse(
    IReadOnlyList<PackageVersionSummaryResponse> Versions,
    string? NextCursor);

public sealed record PackageVersionDetailResponse(
    Guid Id,
    string Version,
    string EngineRange,
    JsonElement Manifest,
    string BundleUrl,
    string BundleSha256Hex,
    int SizeBytes,
    string ScanStatus,
    DateTimeOffset PublishedAt,
    DateTimeOffset? YankedAt,
    string? YankReason);
