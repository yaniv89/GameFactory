namespace Forge.Play;

public static class PlaySecurityHeadersMiddlewareExtensions
{
    /// <summary>
    /// The generic, content-agnostic headers (docs/adr/0010 Decision 6) —
    /// applied to every response, including <c>/health</c> and a 404,
    /// same "registered first so headers survive error responses too"
    /// posture as <c>Forge.Api.Security.SecurityHeaders.UseForgeSecurityHeaders</c>.
    /// <c>Content-Security-Policy</c> is deliberately NOT set here: it's
    /// per-build (<see cref="PlaySecurityHeaders.BuildContentSecurityPolicy"/>),
    /// so only <c>ServeBuildEndpoint</c> — the one route that actually has
    /// a build's hash sources in hand — sets it.
    /// </summary>
    public static IApplicationBuilder UseForgePlaySecurityHeaders(this IApplicationBuilder app)
    {
        return app.Use(async (context, next) =>
        {
            var headers = context.Response.Headers;
            headers["Cross-Origin-Opener-Policy"] = PlaySecurityHeaders.CrossOriginOpenerPolicy;
            headers["Cross-Origin-Resource-Policy"] = PlaySecurityHeaders.CrossOriginResourcePolicy;
            headers["Strict-Transport-Security"] = PlaySecurityHeaders.StrictTransportSecurity;
            headers["X-Content-Type-Options"] = PlaySecurityHeaders.XContentTypeOptions;
            headers["Referrer-Policy"] = PlaySecurityHeaders.ReferrerPolicy;
            headers["Permissions-Policy"] = PlaySecurityHeaders.PermissionsPolicy;
            await next();
        });
    }
}
