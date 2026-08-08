namespace Forge.Infrastructure.RateLimiting;

/// <summary>
/// Centralized in Redis (docs/SPEC.md Section 5.5, CLAUDE.md Section 1.5
/// guardrail 18): never an in-process counter, or a client could exhaust
/// a limit against one API instance and simply retry against another
/// behind the same load balancer. <c>surface</c> names what's being
/// limited (e.g. "auth:login") and <c>identity</c> is the caller (an IP
/// address or a user id, depending on the policy) — together they form
/// the Redis key, so the same caller has an independent budget per
/// surface.
/// </summary>
public interface IRateLimiter
{
    Task<RateLimitResult> CheckAsync(string surface, string identity, RateLimitPolicy policy, CancellationToken ct);
}
