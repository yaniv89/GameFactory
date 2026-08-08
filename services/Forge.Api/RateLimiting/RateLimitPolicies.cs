using Forge.Infrastructure.RateLimiting;

namespace Forge.Api.RateLimiting;

/// <summary>
/// The concrete per-surface budgets (docs/SPEC.md Section 5.5 names the
/// mechanism — centralized Redis, sliding window or token bucket — but
/// doesn't pin numbers; these are this session's call, not lifted from a
/// table in the spec).
/// </summary>
public static class RateLimitPolicies
{
    /// <summary>
    /// Pre-authentication account endpoints (signup, login,
    /// forgot/reset-password, verify-email, resend-verification),
    /// IP-keyed. Each endpoint gets its own surface string (e.g.
    /// <c>auth:login</c>) so they don't share one pool — a burst of
    /// signups from one IP shouldn't cost that IP its login budget —
    /// while all using this same numeric policy. Identity's own
    /// account-level lockout (10 failed attempts, 15 minute lockout — M5
    /// Phase 2) already throttles brute-forcing one specific account;
    /// this is the complementary control for spraying many different
    /// accounts, or hammering signup/password-reset for cost/enumeration
    /// abuse, from a single source.
    /// </summary>
    public static readonly RateLimitPolicy Auth = new(Limit: 30, Window: TimeSpan.FromMinutes(10));

    /// <summary>
    /// <c>/connect/token</c>, IP-keyed. Higher than <see cref="Auth"/>:
    /// a shared office/NAT IP can represent many legitimate users each
    /// independently exchanging codes and rotating refresh tokens.
    /// </summary>
    public static readonly RateLimitPolicy Token = new(Limit: 30, Window: TimeSpan.FromMinutes(5));

    /// <summary>
    /// The general authenticated project API, user-keyed. Generous —
    /// CLAUDE.md Section 5.3's "the canvas never blocks, latency is the
    /// feature" — this exists to bound a runaway client or a bug, not to
    /// throttle normal editing traffic.
    /// </summary>
    public static readonly RateLimitPolicy Api = new(Limit: 300, Window: TimeSpan.FromMinutes(1));

    /// <summary>
    /// CommitRevision and Restore specifically, user-keyed: a Serializable-
    /// isolation transaction against a document that can be up to 32 MB
    /// costs meaningfully more than a metadata read, so it gets its own,
    /// tighter budget rather than sharing <see cref="Api"/>'s.
    /// </summary>
    public static readonly RateLimitPolicy CommitRevision = new(Limit: 60, Window: TimeSpan.FromMinutes(1));
}
