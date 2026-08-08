using Forge.Infrastructure.RateLimiting;
using StackExchange.Redis;
using Testcontainers.Redis;
using Xunit;

namespace Forge.Tests.RateLimiting;

/// <summary>
/// Proves <see cref="RedisRateLimiter"/>'s sliding-window algorithm
/// against a real Redis 7 (Testcontainers) — not a fake or an in-memory
/// substitute, since the whole point of this class (CLAUDE.md Section 1.5
/// guardrail 18) is that the state really is centralized in Redis.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class RedisRateLimiterTests : IAsyncLifetime
{
    private readonly RedisContainer _container = new RedisBuilder().WithImage("redis:7").Build();
    private IConnectionMultiplexer _redis = null!;

    public async Task InitializeAsync()
    {
        await _container.StartAsync();
        _redis = await ConnectionMultiplexer.ConnectAsync(_container.GetConnectionString());
    }

    public async Task DisposeAsync()
    {
        _redis.Dispose();
        await _container.DisposeAsync();
    }

    private RedisRateLimiter NewLimiter() => new(_redis);

    [Fact]
    public async Task Allows_Up_To_The_Limit_Then_Rejects()
    {
        var limiter = NewLimiter();
        var policy = new RateLimitPolicy(Limit: 3, Window: TimeSpan.FromMinutes(1));
        var identity = $"user-{Guid.NewGuid():N}";

        for (var i = 0; i < 3; i++)
        {
            var result = await limiter.CheckAsync("test-surface", identity, policy, CancellationToken.None);
            Assert.True(result.IsAllowed);
        }

        var fourth = await limiter.CheckAsync("test-surface", identity, policy, CancellationToken.None);
        Assert.False(fourth.IsAllowed);
        Assert.True(fourth.RetryAfter > TimeSpan.Zero);
        Assert.True(fourth.RetryAfter <= policy.Window);
    }

    [Fact]
    public async Task Remaining_Counts_Down_As_Requests_Are_Made()
    {
        var limiter = NewLimiter();
        var policy = new RateLimitPolicy(Limit: 5, Window: TimeSpan.FromMinutes(1));
        var identity = $"user-{Guid.NewGuid():N}";

        var first = await limiter.CheckAsync("test-surface", identity, policy, CancellationToken.None);
        var second = await limiter.CheckAsync("test-surface", identity, policy, CancellationToken.None);

        Assert.Equal(4, first.Remaining);
        Assert.Equal(3, second.Remaining);
    }

    [Fact]
    public async Task Different_Identities_Have_Independent_Budgets()
    {
        var limiter = NewLimiter();
        var policy = new RateLimitPolicy(Limit: 1, Window: TimeSpan.FromMinutes(1));
        var surface = $"surface-{Guid.NewGuid():N}";

        var userA = await limiter.CheckAsync(surface, "user-a", policy, CancellationToken.None);
        var userAAgain = await limiter.CheckAsync(surface, "user-a", policy, CancellationToken.None);
        var userB = await limiter.CheckAsync(surface, "user-b", policy, CancellationToken.None);

        Assert.True(userA.IsAllowed);
        Assert.False(userAAgain.IsAllowed);
        Assert.True(userB.IsAllowed);
    }

    [Fact]
    public async Task Different_Surfaces_Have_Independent_Budgets_For_The_Same_Identity()
    {
        var limiter = NewLimiter();
        var policy = new RateLimitPolicy(Limit: 1, Window: TimeSpan.FromMinutes(1));
        var identity = $"user-{Guid.NewGuid():N}";

        var surfaceA = await limiter.CheckAsync("surface-a", identity, policy, CancellationToken.None);
        var surfaceAAgain = await limiter.CheckAsync("surface-a", identity, policy, CancellationToken.None);
        var surfaceB = await limiter.CheckAsync("surface-b", identity, policy, CancellationToken.None);

        Assert.True(surfaceA.IsAllowed);
        Assert.False(surfaceAAgain.IsAllowed);
        Assert.True(surfaceB.IsAllowed);
    }

    [Fact]
    public async Task A_Short_Window_Frees_Up_Budget_Once_It_Elapses()
    {
        var limiter = NewLimiter();
        var policy = new RateLimitPolicy(Limit: 1, Window: TimeSpan.FromMilliseconds(500));
        var identity = $"user-{Guid.NewGuid():N}";
        var surface = $"surface-{Guid.NewGuid():N}";

        var first = await limiter.CheckAsync(surface, identity, policy, CancellationToken.None);
        var immediatelyAfter = await limiter.CheckAsync(surface, identity, policy, CancellationToken.None);

        await Task.Delay(700);
        var afterWindowElapses = await limiter.CheckAsync(surface, identity, policy, CancellationToken.None);

        Assert.True(first.IsAllowed);
        Assert.False(immediatelyAfter.IsAllowed);
        Assert.True(afterWindowElapses.IsAllowed);
    }
}
