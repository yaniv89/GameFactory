using Forge.Infrastructure.RateLimiting;

namespace Forge.Api.RateLimiting;

public static class RateLimitEndpointExtensions
{
    /// <summary><paramref name="surface"/> is the Redis key namespace and the identifier in rejection error messages — keep it stable, it's effectively part of the observability contract, not a free-text label.</summary>
    public static TBuilder WithRateLimit<TBuilder>(this TBuilder builder, string surface, RateLimitKeyStrategy keyStrategy, RateLimitPolicy policy)
        where TBuilder : IEndpointConventionBuilder
    {
        builder.WithMetadata(new RateLimitMetadata(surface, keyStrategy, policy));
        return builder;
    }
}
