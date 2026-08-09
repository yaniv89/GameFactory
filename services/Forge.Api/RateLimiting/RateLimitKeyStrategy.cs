namespace Forge.Api.RateLimiting;

/// <summary>What identifies the caller for a given rate-limit policy.</summary>
public enum RateLimitKeyStrategy
{
    /// <summary>Pre-authentication surfaces (signup, login, password reset, token exchange) — there's no user yet, only a client IP.</summary>
    IpAddress,

    /// <summary>Authenticated API surfaces — keyed by the caller's domain user id, so one user's budget is independent of everyone else's regardless of which IP they're behind.</summary>
    User,

    /// <summary>M7 Phase 7's Play Services surface — keyed by the caller's anonymous <see cref="Forge.Domain.Entities.Player"/> id (from a validated PlayToken), the play-identity equivalent of <see cref="User"/> for a surface that has no Forge account at all.</summary>
    Player,
}
