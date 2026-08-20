using System.Net;
using System.Security.Cryptography;
using System.Text;
using Azure.Storage.Blobs;
using Forge.Infrastructure.Storage;
using Forge.Play;
using Xunit;

namespace Forge.Tests.Features.PlayOrigin;

/// <summary>
/// The security header assertion suite for <c>Forge.Play</c> —
/// docs/adr/0010's own Consequences section calls for this explicitly
/// ("it should get the same CI security gates as everything else —
/// header assertions... before C4 is called done"), same idiom as
/// <see cref="Security.HeaderTests"/> for <c>Forge.Api</c>: boots the
/// real host and asserts headers on an actual response, not just the
/// <see cref="PlaySecurityHeaders"/> constants directly. Uploads its own
/// bundle straight through <see cref="IBuildBundleStorage"/> rather than
/// running a real build (<see cref="Builds.BuildOrchestratorTests"/>
/// already proves that pipeline) — this suite's only job is "does
/// Forge.Play compute and send the right headers for a given build's
/// real hash sources."
///
/// ⚠ Not run in this sandbox: no .NET SDK here. Verified when CI runs on
/// a GitHub-hosted runner.
/// </summary>
public sealed class PlayHeaderTests : IClassFixture<ForgeWebApplicationFactory>, IAsyncLifetime
{
    private readonly ForgeWebApplicationFactory _factory;
    private PlayTestServer _server = null!;
    private HttpClient _client = null!;

    public PlayHeaderTests(ForgeWebApplicationFactory factory)
    {
        _factory = factory;
    }

    public async Task InitializeAsync()
    {
        _server = await PlayTestServer.StartAsync(_factory.AzuriteConnectionString, _factory.RedisConnectionString);
        _client = new HttpClient { BaseAddress = new Uri(_server.BaseUrl) };
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _server.DisposeAsync();
    }

    private async Task<Guid> UploadFixtureBuildAsync()
    {
        var container = new BlobContainerClient(_factory.AzuriteConnectionString, "builds");
        await container.CreateIfNotExistsAsync();
        var storage = new AzureBlobBuildBundleStorage(container);

        var buildId = Guid.NewGuid();
        const string script = "console.log('fixture');";
        const string style = "body{margin:0}";
        var html = Encoding.UTF8.GetBytes($"<!doctype html><html><head><style>{style}</style></head><body><script type=\"module\">{script}</script></body></html>");

        var metadata = new BuildBundleMetadata(
            Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(script))),
            Convert.ToBase64String(SHA256.HashData(Encoding.UTF8.GetBytes(style))));
        await storage.UploadAsync(buildId, html, metadata, CancellationToken.None);
        return buildId;
    }

    [Fact]
    public async Task A_Real_Build_Gets_Its_Own_Per_Build_Csp_With_The_Real_Hash_Sources()
    {
        var buildId = await UploadFixtureBuildAsync();
        var storage = new AzureBlobBuildBundleStorage(new BlobContainerClient(_factory.AzuriteConnectionString, "builds"));
        var metadata = await storage.DownloadMetadataAsync(buildId, CancellationToken.None);

        var response = await _client.GetAsync($"/{buildId}/");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.True(response.Headers.TryGetValues("Content-Security-Policy", out var cspValues));
        var csp = cspValues!.Single();
        Assert.Equal(PlaySecurityHeaders.BuildContentSecurityPolicy(metadata.InlineScriptSha256Base64, metadata.InlineStyleSha256Base64), csp);
        Assert.Contains($"'sha256-{metadata.InlineScriptSha256Base64}'", csp, StringComparison.Ordinal);
        Assert.Contains($"'sha256-{metadata.InlineStyleSha256Base64}'", csp, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ContentSecurityPolicy_Never_Contains_UnsafeEval_Or_UnsafeInline_Or_Wildcard()
    {
        // Regression guard mirroring tools/security/csp-lint.mjs and
        // HeaderTests.cs's own equivalent for Forge.Api, asserted at
        // runtime against the header this host actually sends.
        var buildId = await UploadFixtureBuildAsync();
        var response = await _client.GetAsync($"/{buildId}/");
        response.Headers.TryGetValues("Content-Security-Policy", out var values);
        var csp = values!.Single();

        foreach (var directiveName in new[] { "script-src", "style-src" })
        {
            var directive = csp.Split(';').Select(d => d.Trim()).First(d => d.StartsWith(directiveName, StringComparison.OrdinalIgnoreCase));
            var tokens = directive.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            Assert.DoesNotContain("'unsafe-eval'", tokens);
            Assert.DoesNotContain("'unsafe-inline'", tokens);
            Assert.DoesNotContain("*", tokens);
        }
    }

    [Fact]
    public async Task Response_Sets_Immutable_Cache_Control_And_Html_Content_Type()
    {
        var buildId = await UploadFixtureBuildAsync();
        var response = await _client.GetAsync($"/{buildId}/");

        Assert.Equal("public, max-age=31536000, immutable", response.Headers.CacheControl!.ToString());
        Assert.Equal("text/html", response.Content.Headers.ContentType!.MediaType);
    }

    [Fact]
    public async Task Response_Sets_The_Generic_Platform_Headers()
    {
        var buildId = await UploadFixtureBuildAsync();
        var response = await _client.GetAsync($"/{buildId}/");

        Assert.Equal(PlaySecurityHeaders.CrossOriginOpenerPolicy, response.Headers.GetValues("Cross-Origin-Opener-Policy").Single());
        Assert.Equal(PlaySecurityHeaders.CrossOriginResourcePolicy, response.Headers.GetValues("Cross-Origin-Resource-Policy").Single());
        Assert.Equal(PlaySecurityHeaders.XContentTypeOptions, response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal(PlaySecurityHeaders.ReferrerPolicy, response.Headers.GetValues("Referrer-Policy").Single());
        Assert.Equal(PlaySecurityHeaders.PermissionsPolicy, response.Headers.GetValues("Permissions-Policy").Single());
    }

    [Fact]
    public async Task Unknown_Build_Id_Is_A_Real_404_With_Headers_Still_Present()
    {
        var response = await _client.GetAsync($"/{Guid.NewGuid()}/");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        // Even a 404 gets the generic platform headers — UseForgePlaySecurityHeaders
        // runs before endpoint routing, same "survives error responses too"
        // posture as Forge.Api's own security header middleware.
        Assert.True(response.Headers.Contains("X-Content-Type-Options"));
        // No CSP on a 404 — there's no build to derive hash sources from.
        Assert.False(response.Headers.Contains("Content-Security-Policy"));
    }

    [Fact]
    public async Task Health_Endpoint_Is_Reachable_And_Not_Rate_Limited()
    {
        for (var i = 0; i < 5; i++)
        {
            var response = await _client.GetAsync("/health");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        }
    }
}
