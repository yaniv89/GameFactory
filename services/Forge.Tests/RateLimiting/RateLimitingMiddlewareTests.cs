using System.Net;
using System.Net.Http.Json;
using Forge.Api.RateLimiting;
using Xunit;

namespace Forge.Tests.RateLimiting;

/// <summary>
/// Proves the middleware's HTTP-visible behavior end to end — 429 with a
/// Retry-After header once a real per-surface budget is exhausted —
/// against the real host. <see cref="RedisRateLimiterTests"/> already
/// covers the underlying algorithm in detail; this only needs to show the
/// two are actually wired together correctly.
///
/// Uses its own <see cref="ForgeWebApplicationFactory"/> (own Redis
/// container, own simulated caller IP) rather than sharing one with any
/// other test class — deliberately exhausts a whole policy's budget in
/// one test, which would otherwise starve unrelated tests in the same
/// class that also need to call an auth endpoint.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class RateLimitingMiddlewareTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public RateLimitingMiddlewareTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Exceeding_The_Auth_Budget_Returns_429_With_RetryAfter()
    {
        var client = _factory.CreateClient();

        HttpResponseMessage? rejected = null;
        for (var i = 0; i < RateLimitPolicies.Auth.Limit + 1; i++)
        {
            var response = await client.PostAsJsonAsync("/api/v1/auth/password/forgot", new { email = "nobody@example.com" });
            if (response.StatusCode == HttpStatusCode.TooManyRequests)
            {
                rejected = response;
                break;
            }
            Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        }

        Assert.NotNull(rejected);
        Assert.True(rejected!.Headers.TryGetValues("Retry-After", out var values));
        Assert.True(int.Parse(values!.Single()) > 0);

        var body = await rejected.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();
        Assert.Equal(429, body.GetProperty("status").GetInt32());
        Assert.True(body.GetProperty("retryAfterSeconds").GetInt32() > 0);
    }

    [Fact]
    public async Task A_Different_Surface_Has_An_Independent_Budget()
    {
        var client = _factory.CreateClient();

        // Exhaust password/forgot's budget...
        for (var i = 0; i < RateLimitPolicies.Auth.Limit; i++)
        {
            await client.PostAsJsonAsync("/api/v1/auth/password/forgot", new { email = "nobody@example.com" });
        }
        var exhausted = await client.PostAsJsonAsync("/api/v1/auth/password/forgot", new { email = "nobody@example.com" });
        Assert.Equal(HttpStatusCode.TooManyRequests, exhausted.StatusCode);

        // ...resend-verification, a different surface on the same IP, is unaffected.
        var stillAllowed = await client.PostAsJsonAsync("/api/v1/auth/resend-verification", new { email = "nobody@example.com" });
        Assert.Equal(HttpStatusCode.Accepted, stillAllowed.StatusCode);
    }
}
