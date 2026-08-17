using Microsoft.Extensions.DependencyInjection;

namespace Forge.Functions.Assets;

public static class AssetGateServiceCollectionExtensions
{
    /// <summary>
    /// Wires docs/adr/0012's own pieces. Callers still need
    /// <c>Forge.Infrastructure.DependencyInjection.AddForgeInfrastructure</c>
    /// (for <c>ForgeDbContext</c>) and <c>AddForgeAssetStorage</c> (for
    /// <see cref="Forge.Infrastructure.Storage.IAssetStorage"/>)
    /// registered separately — this only adds what's specific to the
    /// asset worker itself, the same "each AddForgeXxx does one thing"
    /// convention <c>AddForgeBuildGate</c> already follows. No options
    /// class to bind here (unlike <c>AddForgeBuildGate</c>'s
    /// <c>BuildRunnerOptions</c>): <see cref="AssetRunner"/> has no
    /// external process path or per-environment setting to configure —
    /// it's in-process ImageSharp calls only.
    /// </summary>
    public static IServiceCollection AddForgeAssetGate(this IServiceCollection services)
    {
        services.AddSingleton<AssetRunner>();
        services.AddScoped<AssetScanner>();
        services.AddScoped<AssetOrchestrator>();
        return services;
    }
}
