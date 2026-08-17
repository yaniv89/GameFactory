using Forge.Api.Features.Registry.Publishing;

namespace Forge.Api.Features.Registry;

public static class RegistryEndpointsExtensions
{
    /// <summary>Scoped: <see cref="DependencyResolver"/> depends on the scoped <c>ForgeDbContext</c>.</summary>
    public static IServiceCollection AddForgeRegistry(this IServiceCollection services)
    {
        services.AddMemoryCache();
        services.AddScoped<IDependencyResolver, DependencyResolver>();
        return services;
    }

    public static IEndpointRouteBuilder MapRegistryEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapListPackages();
        app.MapPackageDetailAndVersions();
        app.MapResolveDependencies();
        app.MapPublishVersion();
        app.MapReviews();
        return app;
    }
}
