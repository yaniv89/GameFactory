namespace Forge.Api.Features.Marketplace;

public static class MarketplaceEndpointsExtensions
{
    public static IEndpointRouteBuilder MapMarketplaceEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapConnectAccount();
        app.MapSetListing();
        app.MapPurchaseCheckoutSession();
        app.MapLicenses();
        app.MapEarnings();
        app.MapPayouts();
        return app;
    }
}
