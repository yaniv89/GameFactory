using Forge.Functions.Scan.SmokeGate;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace Forge.Functions.Scan;

public static class ScanGateServiceCollectionExtensions
{
    /// <summary>
    /// Wires gate 4's own pieces (docs/SPEC.md Section 10.4). Callers
    /// still need <c>Forge.Infrastructure.DependencyInjection.AddForgeInfrastructure</c>
    /// (for <c>ForgeDbContext</c>) and <c>AddForgeBundleStorage</c> (for
    /// <see cref="Forge.Infrastructure.Storage.IPackageBundleStorage"/>)
    /// registered separately — this only adds what's specific to the
    /// scan gate itself, the same "each AddForgeXxx does one thing"
    /// convention every other DI extension in this repo follows.
    /// </summary>
    public static IServiceCollection AddForgeScanGate(this IServiceCollection services, IConfiguration configuration)
    {
        services.Configure<SmokeGateOptions>(configuration.GetSection(SmokeGateOptions.SectionName));
        services.AddSingleton(sp => sp.GetRequiredService<IOptions<SmokeGateOptions>>().Value);
        services.AddScoped<SmokeRunGate>();
        services.AddScoped<PendingVersionScanner>();
        services.AddScoped<ScanOrchestrator>();
        return services;
    }
}
