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

    public static async Task<AuthenticatedTestUser> SignupAndAuthenticateAsync(ForgeWebApplicationFactory factory)
    {
        var client = factory.CreateClient(new WebApplicationFactoryClientOptions { AllowAutoRedirect = false });
        var email = $"user-{Guid.NewGuid():N}@example.com";
        const string password = "correct horse battery staple 42";

        var signupResponse = await client.PostAsJsonAsync("/api/v1/auth/signup", new { email, password, displayName = "Test User" });
        signupResponse.EnsureSuccessStatusCode();
        var signup = (await signupResponse.Content.ReadFromJsonAsync<SignupResponse>())!;

        var verificationEmail = Assert.Single(factory.EmailSender.Sent, e => e.ToEmail == email && e.Subject.Contains("Verify"));
        var verificationToken = verificationEmail.Body["Verification token: ".Length..];
        (await client.PostAsJsonAsync("/api/v1/auth/verify-email", new { email, token = verificationToken })).EnsureSuccessStatusCode();

        (await client.PostAsJsonAsync("/api/v1/auth/login", new { email, password })).EnsureSuccessStatusCode();

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
        tokenResponse.EnsureSuccessStatusCode();
        var tokenPayload = await tokenResponse.Content.ReadFromJsonAsync<JsonElement>();
        var accessToken = tokenPayload.GetProperty("access_token").GetString()!;

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        return new AuthenticatedTestUser(client, signup.UserId, signup.WorkspaceId, email);
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
