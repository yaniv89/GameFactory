using Forge.Infrastructure;

namespace Forge.Play;

/// <summary>
/// Factored out of <c>Program.cs</c> so <c>Forge.Tests</c> can build a
/// real, independently-bound <see cref="WebApplication"/> for the E2E
/// proof (docs/adr/0010's own C4 scope: "fetch it from a second,
/// genuinely distinct local origin, play it") — a real Playwright browser
/// needs a real TCP-bound Kestrel server to navigate to, which
/// <c>WebApplicationFactory</c>'s default in-memory <c>TestServer</c>
/// does not provide. The test constructs its own <see cref="WebApplicationBuilder"/>
/// (pointed at its own real Testcontainers Redis/Azurite), calls
/// <see cref="AddServices"/>/<see cref="MapEndpoints"/> exactly as
/// <c>Program.cs</c> does, then starts it for real via
/// <c>app.StartAsync()</c> and reads back the OS-assigned port.
/// </summary>
public static class PlayApp
{
    public static void AddServices(WebApplicationBuilder builder)
    {
        builder.Services.AddForgeBuildBundleStorage(builder.Configuration);
        builder.Services.AddForgeRateLimiting(builder.Configuration);
    }

    public static void MapEndpoints(WebApplication app)
    {
        app.UseForgePlaySecurityHeaders();
        app.UseMiddleware<PlayRateLimitingMiddleware>();

        app.MapGet("/health", () => Results.Ok(new { status = "ok" })).WithName("HealthCheck");
        // A real browser auto-requests /favicon.ico on every page load —
        // confirmed by a real Chromium run producing a genuine, harmless
        // console error otherwise (this host serves nothing at that path
        // by design, docs/adr/0010 never scoped per-game favicons). 204,
        // not a 404: this is expected, not missing content.
        app.MapGet("/favicon.ico", () => Results.NoContent()).WithName("Favicon");
        app.MapServeBuild();
    }
}
