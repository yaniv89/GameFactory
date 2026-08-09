namespace Forge.Api.Features.Play;

public static class PlayEndpointsExtensions
{
    public static IEndpointRouteBuilder MapPlayEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapIdentity();
        app.MapSaves();
        app.MapLeaderboards();
        app.MapAchievements();
        app.MapAnalytics();
        return app;
    }
}
