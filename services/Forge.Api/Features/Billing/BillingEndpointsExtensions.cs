namespace Forge.Api.Features.Billing;

public static class BillingEndpointsExtensions
{
    public static IEndpointRouteBuilder MapBillingEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapCheckoutSession();
        app.MapPortalSession();
        app.MapGetBillingStatus();
        app.MapStripeWebhook();
        return app;
    }
}
