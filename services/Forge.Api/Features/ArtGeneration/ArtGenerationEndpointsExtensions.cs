namespace Forge.Api.Features.ArtGeneration;

public static class ArtGenerationEndpointsExtensions
{
    public static IEndpointRouteBuilder MapArtGenerationEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapCreateGenerationRequest();
        app.MapConfirmGenerationRequest();
        return app;
    }
}
