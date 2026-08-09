namespace Forge.Api.Features.Collab;

public static class CollabEndpointExtensions
{
    /// <summary>docs/SPEC.md Section 13.2: <c>WS /hubs/collab?projectId={id}</c>.</summary>
    public static IEndpointRouteBuilder MapCollabHub(this IEndpointRouteBuilder app)
    {
        app.MapHub<CollabHub>("/hubs/collab");
        return app;
    }
}
