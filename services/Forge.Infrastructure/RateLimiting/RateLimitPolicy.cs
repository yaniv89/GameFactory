namespace Forge.Infrastructure.RateLimiting;

/// <summary>At most <see cref="Limit"/> requests per <see cref="Window"/>, per rate-limit key.</summary>
public sealed record RateLimitPolicy(int Limit, TimeSpan Window);

public sealed record RateLimitResult(bool IsAllowed, int Remaining, TimeSpan RetryAfter);
