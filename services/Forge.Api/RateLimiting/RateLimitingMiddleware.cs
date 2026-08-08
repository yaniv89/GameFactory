using Forge.Api.Authorization;
using Forge.Infrastructure.RateLimiting;

namespace Forge.Api.RateLimiting;

/// <summary>
/// Enforces whatever <see cref="RateLimitMetadata"/> the matched endpoint
/// carries (attached via <see cref="RateLimitEndpointExtensions.WithRateLimit{TBuilder}"/>).
/// An endpoint with no such metadata isn't rate-limited by this
/// middleware at all — <c>/health</c> and the OpenAPI-adjacent surface
/// don't need it, and the specific endpoints that do are each tagged
/// explicitly rather than this middleware guessing from the route.
///
/// Placed after <see cref="CurrentUserMiddleware"/> in the pipeline
/// (Program.cs) specifically so <see cref="RateLimitKeyStrategy.User"/>
/// policies can read <see cref="ICurrentUser"/> — which is only correct
/// once <c>CurrentUserMiddleware</c> has already run. This mirrors the
/// exact ordering lesson <see cref="Authorization.WorkspaceRoleHandler"/>'s
/// doc comment describes: reading <c>ICurrentUser</c> any earlier in the
/// pipeline sees it not-yet-populated.
/// </summary>
public sealed class RateLimitingMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, IRateLimiter limiter, ICurrentUser currentUser)
    {
        var metadata = context.GetEndpoint()?.Metadata.GetMetadata<RateLimitMetadata>();
        if (metadata is null)
        {
            await next(context);
            return;
        }

        var identity = metadata.KeyStrategy switch
        {
            RateLimitKeyStrategy.User when currentUser.IsAuthenticated => currentUser.UserId.ToString(),
            // An unauthenticated request against a User-keyed endpoint
            // isn't this middleware's problem to reject — the endpoint's
            // own authorization policy already will — but it still needs
            // *some* budget so it can't bypass limiting entirely by
            // omitting a token.
            RateLimitKeyStrategy.User => "anonymous",
            RateLimitKeyStrategy.IpAddress => context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => "unknown",
        };

        var result = await limiter.CheckAsync(metadata.Surface, identity, metadata.Policy, context.RequestAborted);
        if (!result.IsAllowed)
        {
            var retryAfterSeconds = Math.Max(1, (int)Math.Ceiling(result.RetryAfter.TotalSeconds));
            context.Response.Headers.RetryAfter = retryAfterSeconds.ToString();
            context.Response.StatusCode = StatusCodes.Status429TooManyRequests;
            await context.Response.WriteAsJsonAsync(new
            {
                title = "Too many requests",
                detail = $"Rate limit exceeded for {metadata.Surface}. Try again in {retryAfterSeconds} seconds.",
                status = StatusCodes.Status429TooManyRequests,
                retryAfterSeconds,
            });
            return;
        }

        await next(context);
    }
}
