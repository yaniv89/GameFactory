namespace Forge.Api.Features.Marketplace;

public sealed record ConnectAccountLinkResponse(string OnboardingUrl);

public sealed record SetListingRequest(string PricingModel, int PriceCents);

public sealed record ListingResponse(string PackageName, string PricingModel, int PriceCents, string Currency, int RevenueShareBps, bool IsListed);

public sealed record CreatePurchaseCheckoutSessionRequest(Guid WorkspaceId, string PackageName);

public sealed record PurchaseCheckoutSessionResponse(string Url);

public sealed record LicenseResponse(Guid Id, string PackageName, string GrantedVia, DateTimeOffset GrantedAt, DateTimeOffset? ExpiresAt);

public sealed record AuthorEarningsResponse(int TotalEarnedCents, int PendingPayoutCents, string Currency, int SucceededSaleCount);

public sealed record PayoutHistoryEntryResponse(string StripePayoutId, int AmountCents, string Currency, string Status, DateTimeOffset ArrivalDate);
