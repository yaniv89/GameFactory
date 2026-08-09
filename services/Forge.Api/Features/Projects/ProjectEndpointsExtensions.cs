namespace Forge.Api.Features.Projects;

public static class ProjectEndpointsExtensions
{
    public static IEndpointRouteBuilder MapProjectEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapListProjects();
        app.MapCreateProject();
        app.MapGetProject();
        app.MapUpdateProject();
        app.MapDeleteProject();
        app.MapGetDocument();
        app.MapCommitRevision();
        app.MapListRevisions();
        app.MapRestoreRevision();
        return app;
    }
}
