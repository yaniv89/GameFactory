using Forge.Api.Security;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Forge.Tests.Security;

/// <summary>
/// The security header assertion suite required by CLAUDE.md Section 4.9
/// gate #7 / Section 4.4. Boots the real Forge.Api host in-memory
/// (WebApplicationFactory) and asserts headers on an actual response,
/// rather than asserting against the SecurityHeaders constants directly —
/// the point is to catch the middleware not being wired into the pipeline,
/// not just to check the constant strings are correct.
///
/// ⚠ Not run in this sandbox: no .NET SDK is installed here to execute
/// `dotnet test`. Verified when CI runs on a GitHub-hosted runner.
/// </summary>
public class HeaderTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public HeaderTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Response_Sets_ContentSecurityPolicy()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/health");

        Assert.True(response.Headers.TryGetValues("Content-Security-Policy", out var values));
        Assert.Equal(SecurityHeaders.ContentSecurityPolicy, values!.Single());
    }

    [Fact]
    public async Task ContentSecurityPolicy_Never_Contains_UnsafeEval_Or_UnsafeInline_In_ScriptSrc()
    {
        // Regression guard mirroring tools/security/csp-lint.mjs (CLAUDE.md
        // Section 4.9 gate #9), asserted at runtime against the header
        // this host actually sends, not just the source file.
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/health");
        response.Headers.TryGetValues("Content-Security-Policy", out var values);
        var csp = values!.Single();

        var scriptSrcDirective = csp
            .Split(';')
            .Select(d => d.Trim())
            .First(d => d.StartsWith("script-src", StringComparison.OrdinalIgnoreCase));
        var tokens = scriptSrcDirective.Split(' ', StringSplitOptions.RemoveEmptyEntries);

        Assert.DoesNotContain("'unsafe-eval'", tokens);
        Assert.DoesNotContain("'unsafe-inline'", tokens);
        Assert.DoesNotContain("*", tokens);
    }

    [Fact]
    public async Task Response_Sets_CrossOriginOpenerPolicy()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/health");

        Assert.True(response.Headers.TryGetValues("Cross-Origin-Opener-Policy", out var values));
        Assert.Equal(SecurityHeaders.CrossOriginOpenerPolicy, values!.Single());
    }

    [Fact]
    public async Task Response_Sets_StrictTransportSecurity()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/health");

        Assert.True(response.Headers.TryGetValues("Strict-Transport-Security", out var values));
        Assert.Equal(SecurityHeaders.StrictTransportSecurity, values!.Single());
    }

    [Fact]
    public async Task Response_Sets_XContentTypeOptions_Nosniff()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/health");

        Assert.True(response.Headers.TryGetValues("X-Content-Type-Options", out var values));
        Assert.Equal("nosniff", values!.Single());
    }

    [Fact]
    public async Task Response_Sets_ReferrerPolicy()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/health");

        Assert.True(response.Headers.TryGetValues("Referrer-Policy", out var values));
        Assert.Equal(SecurityHeaders.ReferrerPolicy, values!.Single());
    }

    [Fact]
    public async Task Response_Sets_PermissionsPolicy()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/health");

        Assert.True(response.Headers.TryGetValues("Permissions-Policy", out var values));
        Assert.Equal(SecurityHeaders.PermissionsPolicy, values!.Single());
    }

    [Fact]
    public async Task Headers_Are_Present_Even_On_NotFound_Responses()
    {
        // Headers are registered first in the pipeline (Program.cs) so they
        // apply to error responses too, not just the happy path.
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/this-route-does-not-exist");

        Assert.True(response.Headers.Contains("Content-Security-Policy"));
        Assert.True(response.Headers.Contains("X-Content-Type-Options"));
    }
}
