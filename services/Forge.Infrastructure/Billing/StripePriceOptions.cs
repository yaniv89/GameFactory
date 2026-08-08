namespace Forge.Infrastructure.Billing;

/// <summary>Lets the webhook handler map a Stripe price id back to a plan when a subscription's price changes (an upgrade/downgrade made through the Billing Portal).</summary>
public sealed record StripePriceOptions(string ProPriceId, string StudioPriceId);
