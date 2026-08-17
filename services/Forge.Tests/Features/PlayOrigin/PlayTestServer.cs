using Forge.Play;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Forge.Tests.Features.PlayOrigin;

/// <summary>
/// Boots a real, independently-bound <c>Forge.Play</c> instance for
/// docs/adr/0010's own C4 E2E proof — <see cref="PlayApp"/>'s own doc
/// comment explains why a real, network-bound Kestrel server is needed
/// here rather than <c>WebApplicationFactory</c>'s in-memory TestServer:
/// a real Playwright browser process has to be able to navigate to a
/// real URL, and the whole point of this proof is a real browser
/// enforcing the real per-build CSP this host sends, not a header-string
/// comparison. Points at the same real Testcontainers Azurite/Redis a
/// <see cref="ForgeWebApplicationFactory"/> already manages, rather than
/// spinning up a second, separate pair of containers.
/// </summary>
public sealed class PlayTestServer : IAsyncDisposable
{
    private readonly WebApplication _app;

    private PlayTestServer(WebApplication app, string baseUrl)
    {
        _app = app;
        BaseUrl = baseUrl;
    }

    public string BaseUrl { get; }

    public static async Task<PlayTestServer> StartAsync(string azuriteConnectionString, string redisConnectionString)
    {
        var builder = WebApplication.CreateBuilder();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:Blob"] = azuriteConnectionString,
            ["ConnectionStrings:Redis"] = redisConnectionString,
            ["Blob:BuildsContainer"] = "builds",
        });
        builder.WebHost.UseUrls("http://127.0.0.1:0"); // Port 0: OS assigns a free real port, resolved below after Start.

        PlayApp.AddServices(builder);
        var app = builder.Build();
        PlayApp.MapEndpoints(app);

        await app.StartAsync();

        var addresses = app.Services.GetRequiredService<IServer>().Features.Get<IServerAddressesFeature>()!.Addresses;
        // IServerAddressesFeature.Addresses never carries a trailing
        // slash (confirmed by a real failed navigation before adding
        // this, not assumed) — every caller of BaseUrl builds a URL by
        // concatenating a buildId directly after it, so guaranteeing the
        // slash here once is safer than every call site remembering to.
        var baseUrl = addresses.Single().TrimEnd('/') + "/";

        return new PlayTestServer(app, baseUrl);
    }

    public async ValueTask DisposeAsync()
    {
        await _app.StopAsync();
        await _app.DisposeAsync();
    }
}
