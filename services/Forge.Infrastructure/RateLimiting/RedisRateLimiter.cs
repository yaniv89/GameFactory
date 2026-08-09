using StackExchange.Redis;

namespace Forge.Infrastructure.RateLimiting;

/// <summary>
/// Sliding-window log algorithm (docs/SPEC.md Section 5.5 names sliding
/// window or token bucket; a sliding window log is the more precise of
/// the two — it never lets a caller burst up to 2x the limit across a
/// window boundary the way a fixed-window counter would) backed by a
/// Redis sorted set: each allowed request is a member scored by its own
/// timestamp, expired members are trimmed before counting, and the whole
/// check-and-record is one atomic Lua script so concurrent requests from
/// the same caller can't race past each other between the count and the
/// increment.
/// </summary>
public sealed class RedisRateLimiter(IConnectionMultiplexer redis) : IRateLimiter
{
    private const string ScriptText = """
        local windowStart = tonumber(@now) - tonumber(@window)
        redis.call('ZREMRANGEBYSCORE', @key, '-inf', windowStart)
        local count = redis.call('ZCARD', @key)
        if count < tonumber(@limit) then
            redis.call('ZADD', @key, tonumber(@now), @member)
            redis.call('PEXPIRE', @key, tonumber(@window))
            return {1, tonumber(@limit) - count - 1, 0}
        else
            local oldest = redis.call('ZRANGE', @key, 0, 0, 'WITHSCORES')
            local retryAfterMs = tonumber(@window) - (tonumber(@now) - tonumber(oldest[2]))
            return {0, 0, retryAfterMs}
        end
        """;

    private static readonly LuaScript Script = LuaScript.Prepare(ScriptText);

    public async Task<RateLimitResult> CheckAsync(string surface, string identity, RateLimitPolicy policy, CancellationToken ct)
    {
        var db = redis.GetDatabase();
        var key = (RedisKey)$"ratelimit:{surface}:{identity}";
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var windowMs = (long)policy.Window.TotalMilliseconds;
        // Timestamp alone isn't a safe sorted-set member: two requests in
        // the same millisecond would collide and only count as one.
        var member = (RedisValue)$"{now}-{Guid.NewGuid():N}";

        // ScriptEvaluateAsync has no CancellationToken overload — ct is
        // honored by the caller awaiting this task, not by Redis itself,
        // which is consistent with how the rest of StackExchange.Redis's
        // async surface works.
        var raw = await db.ScriptEvaluateAsync(Script, new
        {
            key,
            now,
            window = windowMs,
            limit = policy.Limit,
            member,
        });

        var result = (RedisResult[])raw!;
        var allowed = (long)result[0] == 1;
        var remaining = (int)(long)result[1];
        var retryAfterMs = (long)result[2];

        return new RateLimitResult(allowed, Math.Max(0, remaining), TimeSpan.FromMilliseconds(Math.Max(0, retryAfterMs)));
    }
}
