using Forge.Infrastructure.RateLimiting;

namespace Forge.Api.RateLimiting;

/// <summary>Endpoint metadata <see cref="RateLimitingMiddleware"/> looks for on the current <see cref="Microsoft.AspNetCore.Http.Endpoint"/>.</summary>
public sealed record RateLimitMetadata(string Surface, RateLimitKeyStrategy KeyStrategy, RateLimitPolicy Policy);
