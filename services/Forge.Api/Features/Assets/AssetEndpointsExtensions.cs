namespace Forge.Api.Features.Assets;

public static class AssetEndpointsExtensions
{
    public static IEndpointRouteBuilder MapAssetEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapUploadAsset();
        app.MapListAssets();
        app.MapDeleteAsset();
        app.MapGetAssetContent();
        return app;
    }
}
