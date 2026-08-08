using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Forge.Api;
using Forge.Api.Features.Auth;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Forge.Tests.Features.Auth;

/// <summary>
/// Drives the entire M5 Phase 2 auth stack through a real HTTP client
/// against the real host — signup, email verification with the actual
/// generated token, password login establishing the Identity cookie, a
/// full OAuth 2.0 authorization-code + PKCE exchange against the real
/// OpenIddict server, and a Bearer-authenticated call to /me. Nothing
/// here is mocked except the outbound email transport (no provider is
/// configured yet — see IEmailSender's own doc comment); Identity,
/// OpenIddict, the database, and every endpoint in between are the real
/// production wiring.
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class AuthFlowTests : IClassFixture<ForgeWebApplicationFactory>
{
    private readonly ForgeWebApplicationFactory _factory;

    public AuthFlowTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Signup_Verify_Login_AuthorizationCodePkce_And_Me_All_Work_End_To_End()
    {
        // AllowAutoRedirect=false: the authorize step's 302 targets the
        // editor SPA's own (not-running-here) dev server — the test
        // reads the Location header itself instead of letting HttpClient
        // try to actually follow it.
        var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var email = $"auth-{Guid.NewGuid():N}@example.com";
        const string password = "correct horse battery staple 42";

        // 1. Signup.
        var signupResponse = await client.PostAsJsonAsync("/api/v1/auth/signup", new { email, password, displayName = "Ada" });
        Assert.Equal(HttpStatusCode.Created, signupResponse.StatusCode);
        var signup = await signupResponse.Content.ReadFromJsonAsync<SignupResponse>();
        Assert.NotNull(signup);
        Assert.NotEqual(Guid.Empty, signup!.WorkspaceId);

        // 2. Verify email using the token the endpoint actually generated
        // (captured by the test email sender, never sent for real).
        var verificationEmail = Assert.Single(_factory.EmailSender.Sent, e => e.ToEmail == email && e.Subject.Contains("Verify"));
        var verificationToken = verificationEmail.Body["Verification token: ".Length..];
        var verifyResponse = await client.PostAsJsonAsync("/api/v1/auth/verify-email", new { email, token = verificationToken });
        Assert.Equal(HttpStatusCode.NoContent, verifyResponse.StatusCode);

        // 3. Login — establishes the Identity application cookie
        // /connect/authorize checks.
        var loginResponse = await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password });
        Assert.Equal(HttpStatusCode.NoContent, loginResponse.StatusCode);

        // 4. Authorization code + PKCE, against the real OpenIddict
        // server, for the real seeded editor client.
        var (verifier, challenge) = CreatePkcePair();
        var authorizeUrl = "/connect/authorize"
            + $"?client_id={OpenIddictSeeding.EditorClientId}"
            + "&response_type=code"
            + "&redirect_uri=" + Uri.EscapeDataString("http://localhost:5190/auth/callback")
            + "&scope=" + Uri.EscapeDataString("openid email profile offline_access forge_api")
            + $"&code_challenge={challenge}"
            + "&code_challenge_method=S256"
            + "&state=xyz";
        var authorizeResponse = await client.GetAsync(authorizeUrl);
        Assert.Equal(HttpStatusCode.Redirect, authorizeResponse.StatusCode);
        var redirectLocation = authorizeResponse.Headers.Location;
        Assert.NotNull(redirectLocation);
        var code = ExtractQueryParam(redirectLocation!, "code");

        // 5. Token exchange.
        var tokenResponse = await client.PostAsync("/connect/token", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "authorization_code",
            ["code"] = code,
            ["redirect_uri"] = "http://localhost:5190/auth/callback",
            ["client_id"] = OpenIddictSeeding.EditorClientId,
            ["code_verifier"] = verifier,
        }));
        Assert.True(tokenResponse.IsSuccessStatusCode, await tokenResponse.Content.ReadAsStringAsync());
        var tokenPayload = await tokenResponse.Content.ReadFromJsonAsync<JsonElement>();
        var accessToken = tokenPayload.GetProperty("access_token").GetString();
        Assert.False(string.IsNullOrEmpty(accessToken));
        var refreshToken = tokenPayload.TryGetProperty("refresh_token", out var rt) ? rt.GetString() : null;
        Assert.False(string.IsNullOrEmpty(refreshToken));

        // 6. /me, Bearer-authenticated with the token just issued.
        var meRequest = new HttpRequestMessage(HttpMethod.Get, "/api/v1/me");
        meRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        var meResponse = await client.SendAsync(meRequest);
        Assert.True(meResponse.IsSuccessStatusCode, await meResponse.Content.ReadAsStringAsync());
        var me = await meResponse.Content.ReadFromJsonAsync<MeResponse>();
        Assert.NotNull(me);
        Assert.Equal(email, me!.Email);
        Assert.NotNull(me.EmailVerifiedAt);
        var workspace = Assert.Single(me.Workspaces);
        Assert.Equal(signup.WorkspaceId, workspace.WorkspaceId);
        Assert.Equal("owner", workspace.Role);

        // 7. Logout revokes the refresh token — reusing it must fail.
        var logoutResponse = await client.PostAsJsonAsync("/connect/logout", new { refreshToken });
        Assert.Equal(HttpStatusCode.NoContent, logoutResponse.StatusCode);

        var refreshAttempt = await client.PostAsync("/connect/token", new FormUrlEncodedContent(new Dictionary<string, string>
        {
            ["grant_type"] = "refresh_token",
            ["refresh_token"] = refreshToken!,
            ["client_id"] = OpenIddictSeeding.EditorClientId,
        }));
        Assert.False(refreshAttempt.IsSuccessStatusCode);
    }

    [Fact]
    public async Task Concurrent_Signups_With_The_Same_Display_Name_Both_Get_Their_Own_Workspace()
    {
        // A real CI run of M5 Phase 6's load test (many simulated editors
        // all signing up as "Test User") caught SignupEndpoint racing on
        // its own workspace-slug uniqueness check: two concurrent signups
        // with the same display name could both pass an availability
        // check before either committed, and the second insert then threw
        // an unhandled 500 instead of retrying with a different slug.
        // This is the fast, deterministic regression test for that fix —
        // two, not two hundred, and no HTTP-level retry loop of its own,
        // so a reintroduced race fails this directly rather than only
        // showing up as one flaky failure in eighty seconds of load test.
        const string displayName = "Duplicate Display Name";

        var responses = await Task.WhenAll(Enumerable.Range(0, 2).Select(async i =>
        {
            var client = _factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
            var email = $"dup-{i}-{Guid.NewGuid():N}@example.com";
            return await client.PostAsJsonAsync("/api/v1/auth/signup", new { email, password = "correct horse battery staple 42", displayName });
        }));

        foreach (var response in responses)
        {
            Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        }

        var signups = await Task.WhenAll(responses.Select(r => r.Content.ReadFromJsonAsync<SignupResponse>()));
        Assert.NotEqual(signups[0]!.WorkspaceId, signups[1]!.WorkspaceId);
    }

    [Fact]
    public async Task Unauthenticated_Request_To_Me_Is_Rejected()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/v1/me");
        Assert.False(response.IsSuccessStatusCode);
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
