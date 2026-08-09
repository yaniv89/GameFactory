using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Forge.Api;
using Forge.Api.Features.Auth;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Forge.Tests;

public sealed record AuthenticatedTestUser(HttpClient Client, Guid UserId, Guid WorkspaceId, string Email);

/// <summary>
/// Drives the real signup -> verify -> login -> authorization-code+PKCE
/// -> token-exchange flow (the same one <see cref="Features.Auth.AuthFlowTests"/>
/// asserts on directly) so every other feature's integration tests can
/// get a real Bearer-authenticated client in one call instead of
/// duplicating that dance. Nothing here is mocked except the email
/// transport, same as AuthFlowTests.
/// </summary>
public static class AuthTestHelper
{
    private const string RedirectUri = "http://localhost:5190/auth/callback";

    public static Task<AuthenticatedTestUser> SignupAndAuthenticateAsync(ForgeWebApplicationFactory factory) =>
        SignupAndAuthenticateAsync(factory, verifyEmail: true);

    /// <summary>
    /// <paramref name="verifyEmail"/> defaults to true for every existing
    /// caller — login itself doesn't require a verified email
    /// (docs/SPEC.md Section 23.3: "the gate is at checkout/publish, not
    /// login," AddForgeAuth's own <c>RequireConfirmedEmail = false</c>),
    /// so the only reason to pass false is a test that specifically wants
    /// an authenticated-but-unverified user (M6 Phase 2's publish-gate
    /// tests).
    /// </summary>
    public static async Task<AuthenticatedTestUser> SignupAndAuthenticateAsync(ForgeWebApplicationFactory factory, bool verifyEmail)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });

        // Every simulated user gets its own synthetic source address
        // (RateLimitingMiddleware's IpAddress-keyed policies read
        // Connection.RemoteIpAddress, which UseForwardedHeaders derives
        // from this). Without it, every signup in a test run shares one
        // identity against the 30-per-10-minute Auth policy — three
        // Auth-surface calls per user (signup, verify-email, login) means
        // as few as 10 simulated users in one test class would 429 each
        // other, which is a test-harness artifact, not the real-world
        // scenario a rate limit keyed on IP is meant to model.
        client.DefaultRequestHeaders.Add("X-Forwarded-For", RandomPrivateIPv4());

        var email = $"user-{Guid.NewGuid():N}@example.com";
        const string password = "correct horse battery staple 42";

        var signupResponse = await client.PostAsJsonAsync("/api/v1/auth/signup", new { email, password, displayName = "Test User" });
        await EnsureSuccessAsync(signupResponse);
        var signup = (await signupResponse.Content.ReadFromJsonAsync<SignupResponse>())!;

        if (verifyEmail)
        {
            var verificationEmail = Assert.Single(factory.EmailSender.Sent, e => e.ToEmail == email && e.Subject.Contains("Verify"));
            var verificationToken = verificationEmail.Body["Verification token: ".Length..];
            await EnsureSuccessAsync(await client.PostAsJsonAsync("/api/v1/auth/verify-email", new { email, token = verificationToken }));
        }

        await EnsureSuccessAsync(await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password }));

        var (verifier, challenge) = CreatePkcePair();
        var authorizeUrl = "/connect/authorize"
            + $"?client_id={OpenIddictSeeding.EditorClientId}"
            + "&response_type=code"
            + "&redirect_uri=" + Uri.EscapeDataString(RedirectUri)
            + "&scope=" + Uri.EscapeDataString("openid email profile offline_access forge_api")
            + $"&code_challenge={challenge}"
            + "&code_challenge_method=S256"
            + "&state=xyz";
        var authorizeResponse = await client.GetAsync(authorizeUrl);
        var code = ExtractQueryParam(authorizeResponse.Headers.Location!, "code");

        var tokenResponse = await client.PostAsync("/connect/token", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = RedirectUri,
            ["client_id"] = OpenIddictSeeding.EditorClientId,
            ["code_verifier"] = verifier,
        }));
        await EnsureSuccessAsync(tokenResponse);
        var tokenPayload = await tokenResponse.Content.ReadFromJsonAsync<JsonElement>();
        var accessToken = tokenPayload.GetProperty("access_token").GetString()!;

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        return new AuthenticatedTestUser(client, signup.UserId, signup.WorkspaceId, email);
    }

    /// <summary>
    /// <c>HttpResponseMessage.EnsureSuccessStatusCode()</c> throws with
    /// just the status code, discarding the response body — which, in
    /// this Development-environment test host, is exactly where
    /// <c>DeveloperExceptionPageMiddlewareImpl</c> puts the real server-
    /// side stack trace on a 500. A load test that fails with only
    /// "500 Internal Server Error" and no body is the same
    /// "something failed" anti-pattern CLAUDE.md Section 5.5 bars for
    /// product error copy, just relocated into test diagnostics — every
    /// caller in this file uses this instead so a real CI failure comes
    /// with an actual cause attached.
    /// </summary>
    private static async Task EnsureSuccessAsync(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode) return;
        var body = await response.Content.ReadAsStringAsync();
        throw new InvalidOperationException(
            $"{(int)response.StatusCode} {response.StatusCode} calling {response.RequestMessage?.Method} {response.RequestMessage?.RequestUri}: {body}");
    }

    private static string RandomPrivateIPv4()
    {
        var octets = RandomNumberGenerator.GetBytes(3).Select(b => (byte)(1 + b % 254)).ToArray();
        return $"10.{octets[0]}.{octets[1]}.{octets[2]}";
    }

    private static (string Verifier, string Challenge) CreatePkcePair()
    {
        var verifier = Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var challenge = Base64UrlEncode(SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        return (verifier, challenge);
    }

    private static string Base64UrlEncode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static string ExtractQueryParam(Uri uri, string name)
    {
        var query = uri.Query.TrimStart('?');
        foreach (var pair in query.Split('&'))
        {
            var parts = pair.Split('=', 2);
            if (parts.Length == 2 && parts[0] == name) return Uri.UnescapeDataString(parts[1]);
        }
        throw new InvalidOperationException($"No '{name}' parameter in {uri}.");
    }
}
