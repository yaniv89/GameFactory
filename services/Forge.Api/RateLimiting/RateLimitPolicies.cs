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

    /// <summary>
    /// The public registry browse surface (list/get packages and
    /// versions, M6 Phase 1), IP-keyed since browsing the catalog doesn't
    /// require authentication — anyone can look up a package the way
    /// npm's registry API works. Generous like <see cref="Api"/>, but a
    /// separate policy so a scraper hammering the catalog can't also cost
    /// well-behaved anonymous browsers their own budget by sharing one
    /// pool with something else IP-keyed.
    /// </summary>
    public static readonly RateLimitPolicy Registry = new(Limit: 300, Window: TimeSpan.FromMinutes(1));

    /// <summary>
    /// Anonymous play-identity minting (docs/SPEC.md Section 17),
    /// IP-keyed — tighter than <see cref="Auth"/>: there's no
    /// email/password cost to minting a new anonymous player identity,
    /// so this is the only real friction against a script spraying fresh
    /// ones.
    /// </summary>
    public static readonly RateLimitPolicy PlayIdentity = new(Limit: 20, Window: TimeSpan.FromMinutes(10));

    /// <summary>
    /// Authenticated Play Services calls (saves/achievements/analytics),
    /// player-keyed — generous like <see cref="Api"/>, but its own pool
    /// so a runaway published-game client can't cost the editor API
    /// surface anything.
    /// </summary>
    public static readonly RateLimitPolicy Play = new(Limit: 300, Window: TimeSpan.FromMinutes(1));

    /// <summary>
    /// Leaderboard score submissions specifically, player-keyed and
    /// tighter than <see cref="Play"/> — docs/SPEC.md Section 17's own
    /// anti-cheat mitigation list names "rate limits" first, and a
    /// fixed-step-simulation game has no legitimate reason to submit more
    /// than a handful of scores a minute.
    /// </summary>
    public static readonly RateLimitPolicy LeaderboardSubmit = new(Limit: 10, Window: TimeSpan.FromMinutes(1));

    /// <summary>
    /// Build creation specifically (docs/adr/0010), user-keyed and much
    /// tighter than <see cref="CommitRevision"/>: unlike a metadata
    /// write, each one queues a real `vite build` subprocess for
    /// <c>Forge.Functions.Build</c> to run — cheap for this endpoint
    /// itself (it only inserts a row), but the point of the limit is
    /// bounding how much worker/Blob Storage cost one account can queue
    /// per minute, not this request's own handling cost.
    /// </summary>
    public static readonly RateLimitPolicy CreateBuild = new(Limit: 5, Window: TimeSpan.FromMinutes(1));

    /// <summary>
    /// Asset upload specifically (docs/adr/0012), user-keyed and tighter
    /// than <see cref="Api"/> for the same reason as <see cref="CreateBuild"/>:
    /// cheap for this endpoint itself (a Blob write plus one row insert),
    /// but the point is bounding how much quarantine-storage and eventual
    /// <c>Forge.Functions.Assets</c> processing cost one account can queue
    /// per minute — a runaway or malicious client uploading a rapid stream
    /// of 10 MiB files is the actual thing this budgets against, not
    /// ordinary asset-browsing traffic (that stays on <see cref="Api"/>
    /// via the list/get endpoints).
    /// </summary>
    public static readonly RateLimitPolicy AssetUpload = new(Limit: 20, Window: TimeSpan.FromMinutes(1));

    /// <summary>
    /// AI art-generation specifically (docs/adr/0016), user-keyed and the
    /// tightest of any per-minute-scale policy here: each call is a real,
    /// metered external API cost (unlike every other policy above, which
    /// bounds Forge's own compute/storage), so the request-rate limiter
    /// is deliberately conservative. It's also only the *first* of two
    /// independent controls on that cost — docs/adr/0016 Decision 6's
    /// live per-workspace-per-day budget check is the second, and bounds
    /// total volume rather than burst rate.
    ///
    /// N6: deliberately flat across Pro and Studio, unlike that daily
    /// budget (<c>CreateGenerationRequestEndpoint.DailyBudgetByPlan</c>),
    /// which does scale with plan. The two controls guard different
    /// things — this one exists purely to stop a single account from
    /// hammering the endpoint in a short window (a scripted client, a
    /// retry loop gone wrong), and a Studio workspace's higher price
    /// point doesn't make that abuse pattern any less worth stopping at
    /// the same rate. Studio's real, paid-for benefit is the higher
    /// *total daily volume* it can spend — that's what the plan-tiered
    /// budget check is for.
    /// </summary>
    public static readonly RateLimitPolicy ArtGeneration = new(Limit: 10, Window: TimeSpan.FromHours(1));
}
