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

/// <param name="AverageRating">The raw (non-Bayesian-shrunk) average of this package's own reviews (F1) — null when it has none. The ranking algorithm uses the shrunk estimate instead (<see cref="Forge.Domain.Marketplace.PackageRankingCalculator.CalculateBayesianRating"/>); this is the honest number to show a person looking at the package's own page.</param>
/// <param name="PricingModel">free | one_time | subscription (<see cref="Forge.Domain.Entities.ListingPricingModel"/>) — every package has exactly one <see cref="Forge.Domain.Entities.Listing"/> row (that entity's own doc comment: created free the moment the package is), so this is never null. Surfaced here (G2) because nothing before this read the package's own price back to a client at all — <c>SetListingEndpoint</c> only ever accepted a new one.</param>
/// <param name="PriceCents">0 for a free listing, matching <see cref="Forge.Domain.Entities.Listing.PriceCents"/>'s own <c>ck_price</c> database constraint.</param>
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
    DateTimeOffset CreatedAt,
    double? AverageRating,
    int ReviewCount,
    string PricingModel,
    int PriceCents);

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
