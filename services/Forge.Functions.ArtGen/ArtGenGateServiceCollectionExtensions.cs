using Forge.Functions.Assets;
using Microsoft.Extensions.DependencyInjection;

namespace Forge.Functions.ArtGen;

public static class ArtGenGateServiceCollectionExtensions
{
    /// <summary>
    /// Wires docs/adr/0016's own pieces. Callers still need
    /// <c>Forge.Infrastructure.DependencyInjection.AddForgeInfrastructure</c>
    /// (for <c>ForgeDbContext</c>), <c>AddForgeArtGenerationStorage</c>
    /// (for <see cref="Forge.Infrastructure.Storage.IArtGenerationStorage"/>),
    /// and <c>AddForgeArtGeneration</c> (for <see cref="Forge.Infrastructure.ArtGeneration.IArtGenerationClient"/>)
    /// registered separately — this only adds what's specific to this
    /// worker itself, the same "each AddForgeXxx does one thing"
    /// convention <c>AddForgeAssetGate</c> already follows.
    /// <see cref="AssetRunner"/> is registered here too rather than
    /// assuming a caller already has it: <c>Forge.Functions.Assets</c>'s
    /// own <c>AddForgeAssetGate</c> registers it as a singleton, but this
    /// worker process never calls that method (it has no reason to also
    /// wire <c>AssetScanner</c>/<c>AssetOrchestrator</c>, which are
    /// specific to the <c>assets</c> table) — this is the one piece of
    /// that method's registration this project actually needs, taken
    /// directly rather than pulling in the whole method's side effects.
    /// </summary>
    public static IServiceCollection AddForgeArtGenGate(this IServiceCollection services)
    {
        services.AddSingleton<AssetRunner>();
        services.AddScoped<ArtGenScanner>();
        services.AddScoped<ArtGenOrchestrator>();
        return services;
    }
}
