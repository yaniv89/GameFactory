namespace Forge.Api.Features.ArtGeneration;

public static class ArtGenerationEndpointsExtensions
{
    public static IEndpointRouteBuilder MapArtGenerationEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapCreateGenerationRequest();
        app.MapConfirmGenerationRequest();
        app.MapGetGenerationRequest();
        app.MapGetGenerationVariationContent();
        app.MapSelectGenerationVariation();
        return app;
    }
}
