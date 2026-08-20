namespace Forge.Play;

/// <summary>
/// The play origin's own response security headers — docs/adr/0010
/// Decision 6, a genuinely distinct policy from <c>Forge.Api.Security.SecurityHeaders</c>
/// (not shared code: these two hosts deliberately don't reference each
/// other, see <c>Forge.Play.csproj</c>'s own remarks). Several constants
/// below are byte-identical to that class's on purpose — HSTS, nosniff,
/// referrer policy, and permissions policy are genuinely content-agnostic
/// platform defaults, not something that should differ just because
/// nothing shares the source.
/// </summary>
public static class PlaySecurityHeaders
{
    /// <summary>
    /// <see cref="scriptSha256Base64"/>/<see cref="styleSha256Base64"/>
    /// come from a specific build's own <c>meta.json</c> sidecar
    /// (<c>Forge.Functions.Build</c>'s own doc comments on why these are
    /// computed per build, never hardcoded) — every played game gets a
    /// CSP pinned to its own real, hashed inline content, never
    /// `'unsafe-inline'`/`'unsafe-eval'` anywhere, the same NON-NEGOTIABLE
    /// rule <c>Forge.Api</c>'s own CSP follows.
    /// </summary>
    public static string BuildContentSecurityPolicy(string scriptSha256Base64, string styleSha256Base64) =>
        "default-src 'none'; " +
        $"script-src 'self' 'wasm-unsafe-eval' 'sha256-{scriptSha256Base64}'; " +
        $"style-src 'self' 'sha256-{styleSha256Base64}'; " +
        "connect-src 'self' https://api.forge.dev; " +
        "img-src 'self' data: blob:; " +
        "font-src 'self' data:; " +
        "worker-src 'self' blob:; " +
        "form-action 'none'; " +
        "frame-ancestors 'none'; " +
        "base-uri 'none'; " +
        "object-src 'none'; " +
        "upgrade-insecure-requests";

    public const string CrossOriginOpenerPolicy = "same-origin";
    public const string CrossOriginResourcePolicy = "same-origin";
    public const string StrictTransportSecurity = "max-age=63072000; includeSubDomains; preload";
    public const string XContentTypeOptions = "nosniff";
    public const string ReferrerPolicy = "strict-origin-when-cross-origin";
    public const string PermissionsPolicy = "geolocation=(), microphone=(), camera=(), payment=(), usb=()";
}
