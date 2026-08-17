namespace Forge.Api.Features.Marketplace;

public static class MarketplaceEndpointsExtensions
{
    public static IEndpointRouteBuilder MapMarketplaceEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapConnectAccount();
        // SetListingEndpoint no longer registers its own route — see its
        // own doc comment. ReviewsEndpoint's MapReviews (called from
        // MapRegistryEndpoints) owns the one PUT /api/v1/packages/{*path}
        // route and dispatches into SetListingEndpoint.Handle.
        app.MapPurchaseCheckoutSession();
        app.MapLicenses();
        app.MapEarnings();
        app.MapPayouts();
        return app;
    }
}
