namespace Forge.Api.Features.Builds;

public static class BuildEndpointsExtensions
{
    public static IEndpointRouteBuilder MapBuildEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapCreateBuild();
        app.MapGetBuild();
        app.MapListBuilds();
        return app;
    }
}
