using Microsoft.AspNetCore.Http;

namespace Forge.Infrastructure.Identity;

/// <summary>
/// The refresh token lives in an httpOnly, <c>SameSite=Strict</c> cookie —
/// never the <c>/connect/token</c> JSON response body, never anywhere
/// client JS can read it (CLAUDE.md Section 4.7 / Section 12 item 2: "the
/// answer is a refresh cookie and a broadcast channel" — the broadcast
/// channel half already existed client-side; this is the cookie half).
/// Shared between <see cref="DependencyInjection"/>'s OpenIddict event
/// handlers (which set/read it) and <c>LogoutEndpoint.cs</c> (which reads
/// and clears it) so both sides agree on the exact name and options —
/// mismatched <see cref="CookieOptions.Path"/>/<c>SameSite</c> between a
/// cookie's set and its delete is a classic way to leave one silently
/// un-deletable.
/// </summary>
public static class RefreshTokenCookie
{
    public const string Name = "forge_rt";

    /// <summary>
    /// <see cref="CookieOptions.Path"/> is scoped to <c>/connect</c> —
    /// the token and logout endpoints, the only two that ever need this
    /// cookie — rather than the whole origin, so it's never attached to
    /// any other request the browser makes, not even same-origin ones to
    /// <c>/api/*</c>. <paramref name="isDevelopment"/> makes
    /// <see cref="CookieOptions.Secure"/> conditional for the same reason
    /// OpenIddict's own transport-security check already is on this
    /// builder (<c>DisableTransportSecurityRequirement</c>): local dev and
    /// the test host are both plain HTTP; a real deployment always sets it.
    /// </summary>
    public static CookieOptions BuildOptions(bool isDevelopment) => new()
    {
        HttpOnly = true,
        Secure = !isDevelopment,
        SameSite = SameSiteMode.Strict,
        Path = "/connect",
        MaxAge = TimeSpan.FromDays(30), // matches AddForgeAuth's SetRefreshTokenLifetime.
    };
}
