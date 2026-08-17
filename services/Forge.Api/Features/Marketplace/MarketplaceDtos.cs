using System.Text.Json;

namespace Forge.Api.Features.Marketplace;

public sealed record ConnectAccountLinkResponse(string OnboardingUrl);

public sealed record SetListingRequest(string PricingModel, int PriceCents);

public sealed record ListingResponse(string PackageName, string PricingModel, int PriceCents, string Currency, int RevenueShareBps, bool IsListed);

public sealed record CreatePurchaseCheckoutSessionRequest(Guid WorkspaceId, string PackageName);

public sealed record PurchaseCheckoutSessionResponse(string Url);

public sealed record LicenseResponse(Guid Id, string PackageName, string GrantedVia, DateTimeOffset GrantedAt, DateTimeOffset? ExpiresAt);

public sealed record AuthorEarningsResponse(int TotalEarnedCents, int PendingPayoutCents, string Currency, int SucceededSaleCount);

public sealed record PayoutHistoryEntryResponse(string StripePayoutId, int AmountCents, string Currency, string Status, DateTimeOffset ArrivalDate);

/// <summary>
/// The version an "Install" action should actually install — see
/// <see cref="InstallEligibilityEndpoint"/>. <paramref name="BundleSha256Hex"/>
/// travels with the install (through the project document, through export)
/// so whatever eventually fetches <paramref name="BundleUrl"/> over public
/// HTTP can verify the bytes it got are the exact ones this package
/// version published — the same integrity property <c>DependencyResolver</c>
/// already gives the runtime via a Subresource-Integrity-shaped hash for
/// browser-side dependency loading, just checked manually here since a
/// CLI/build-time fetch has no browser SRI to lean on.
/// </summary>
public sealed record MarketplaceInstallableResponse(string PackageName, string Version, JsonElement Manifest, string BundleUrl, string BundleSha256Hex);
