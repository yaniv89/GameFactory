using Forge.Infrastructure.RateLimiting;

namespace Forge.Play;

/// <summary>
/// docs/adr/0010 Decision 5's own reasoning: this is the first public,
/// fully unauthenticated GET surface in this repo (no <c>ICurrentUser</c>,
/// no session, nothing to key a per-user budget on), and a real CDN
/// absorbing the overwhelming majority of repeat traffic via the
/// <c>immutable</c> cache header is the intended production shape — this
/// middleware is the fallback protecting Blob Storage/Redis themselves
/// from direct abuse before that CDN exists. IP-keyed only, not the
/// fuller <c>RateLimitMetadata</c>/<c>WithRateLimit</c> endpoint-metadata
/// system <c>Forge.Api.RateLimiting</c> has: that system exists to give
/// many different endpoints each their own named policy, and this host
/// has exactly one real route to protect — reusing only the shared,
/// host-agnostic <see cref="IRateLimiter"/> underneath it is the
/// "smallest complete slice," not a missing feature.
/// </summary>
public sealed class PlayRateLimitingMiddleware(RequestDelegate next)
{
    private static readonly RateLimitPolicy ServeBuildPolicy = new(Limit: 120, Window: TimeSpan.FromMinutes(1));

    public async Task InvokeAsync(HttpContext context, IRateLimiter limiter)
    {
        if (!context.Request.Path.StartsWithSegments("/health", StringComparison.Ordinal))
        {
            var identity = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            var result = await limiter.CheckAsync("play:serve-build", identity, ServeBuildPolicy, context.RequestAborted);
            if (!result.IsAllowed)
            {
                var retryAfterSeconds = Math.Max(1, (int)Math.Ceiling(result.RetryAfter.TotalSeconds));
                context.Response.Headers.RetryAfter = retryAfterSeconds.ToString();
                context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                await context.Response.WriteAsJsonAsync(new
                {
                    title = "Too many requests",
                    detail = $"Rate limit exceeded. Try again in {retryAfterSeconds} seconds.",
                    status = StatusCodes.Status429TooManyRequests,
                    retryAfterSeconds,
                });
                return;
            }
        }

        await next(context);
    }
}
