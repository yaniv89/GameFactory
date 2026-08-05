namespace Forge.Api.Security;

/// <summary>
/// Response security headers, per docs/SPEC.md Section 4.4. Kept as named
/// constants (not inline strings scattered across the codebase) so
/// tools/security/csp-lint.mjs has one file to check, and so
/// services/Forge.Tests/Security/HeaderTests.cs asserts against the same
/// source of truth this middleware applies.
///
/// This is the platform security baseline applied to every response from
/// this host. The play origin's per-game CSP (docs/SPEC.md Section 4.4,
/// second block — its connect-src is assembled per-project from granted
/// module capabilities) is a distinct policy applied where published games
/// are actually served, starting in Milestone M6. It is not this one.
/// </summary>
public static class SecurityHeaders
{
    /// <summary>
    /// The editor-origin CSP from docs/SPEC.md Section 4.4. NEVER add
    /// 'unsafe-eval' or 'unsafe-inline' to script-src, and never wildcard
    /// a directive — CLAUDE.md Section 1.1 guardrail 2 and Section 4.9's
    /// CSP linter both treat that as a hard failure, not a warning.
    /// </summary>
    public const string ContentSecurityPolicy =
        "default-src 'none'; " +
        "script-src 'self' 'wasm-unsafe-eval'; " +
        "style-src 'self'; " +
        "img-src 'self' https://cdn.forge.dev data: blob:; " +
        "font-src 'self' https://cdn.forge.dev; " +
        "connect-src 'self' https://api.forge.dev wss://api.forge.dev; " +
        "frame-src https://play.forge.dev; " +
        "worker-src 'self' blob:; " +
        "form-action 'none'; " +
        "frame-ancestors 'none'; " +
        "base-uri 'none'; " +
        "object-src 'none'; " +
        "upgrade-insecure-requests; " +
        "report-uri /api/v1/csp-report";

    public const string CrossOriginOpenerPolicy = "same-origin";
    public const string CrossOriginResourcePolicy = "same-origin";
    public const string StrictTransportSecurity = "max-age=63072000; includeSubDomains; preload";
    public const string XContentTypeOptions = "nosniff";
    public const string ReferrerPolicy = "strict-origin-when-cross-origin";
    public const string PermissionsPolicy = "geolocation=(), microphone=(), camera=(), payment=(), usb=()";

    /// <summary>
    /// Applies the full header set to every response. Registered first in
    /// the middleware pipeline so headers are present on error responses
    /// too, not just the happy path.
    /// </summary>
    public static IApplicationBuilder UseForgeSecurityHeaders(this IApplicationBuilder app)
    {
        return app.Use(async (context, next) =>
        {
            var headers = context.Response.Headers;
            headers["Content-Security-Policy"] = ContentSecurityPolicy;
            headers["Cross-Origin-Opener-Policy"] = CrossOriginOpenerPolicy;
            headers["Cross-Origin-Resource-Policy"] = CrossOriginResourcePolicy;
            headers["Strict-Transport-Security"] = StrictTransportSecurity;
            headers["X-Content-Type-Options"] = XContentTypeOptions;
            headers["Referrer-Policy"] = ReferrerPolicy;
            headers["Permissions-Policy"] = PermissionsPolicy;
            await next();
        });
    }
}
