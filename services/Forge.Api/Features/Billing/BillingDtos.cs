namespace Forge.Api.Features.Billing;

public sealed record CheckoutSessionRequest(string Plan);

public sealed record CheckoutSessionResponse(string Url);

public sealed record PortalSessionResponse(string Url);

public sealed record BillingStatusResponse(
    string Plan,
    string? SubscriptionStatus,
    DateTimeOffset? CurrentPeriodEnd,
    bool CancelAtPeriodEnd);
