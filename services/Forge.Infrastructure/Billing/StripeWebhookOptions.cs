namespace Forge.Infrastructure.Billing;

/// <summary>The signing secret Stripe used to sign webhook payloads — verified by <c>Stripe.EventUtility.ConstructEvent</c>, never trusted without it.</summary>
public sealed record StripeWebhookOptions(string Secret);
