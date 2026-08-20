using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Forge.Functions.Build;

public static class BuildGateServiceCollectionExtensions
{
    /// <summary>
    /// Wires docs/adr/0010's own pieces. Callers still need
    /// <c>Forge.Infrastructure.DependencyInjection.AddForgeInfrastructure</c>
    /// (for <c>ForgeDbContext</c>) and <c>AddForgeBuildBundleStorage</c>
    /// (for <see cref="Forge.Infrastructure.Storage.IBuildBundleStorage"/>)
    /// registered separately — this only adds what's specific to the
    /// build worker itself, the same "each AddForgeXxx does one thing"
    /// convention <c>AddForgeScanGate</c> already follows.
    /// </summary>
    public static IServiceCollection AddForgeBuildGate(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<BuildRunnerOptions>(configuration.GetSection(BuildRunnerOptions.SectionName));
        services.AddSingleton(sp => sp.GetRequiredService<IOptions<BuildRunnerOptions>>().Value);
        services.AddScoped<BuildRunner>();
        services.AddScoped<BuildScanner>();
        services.AddScoped<BuildOrchestrator>();
        return services;
    }
}
