using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;

namespace Forge.Infrastructure.Play;

/// <summary>The claim type <see cref="PlayTokenAuthenticationHandler"/> puts the verified player id under — not <c>ClaimTypes.NameIdentifier</c> or OpenIddict's <c>sub</c>, since a play token is a deliberately separate identity from a Forge account (<see cref="Domain.Entities.Player"/>'s own doc comment).</summary>
public static class PlayClaimTypes
{
    public const string PlayerId = "play_player_id";

    /// <summary>Every Play Services endpoint reads the authenticated player id this same way — centralized so a malformed/missing claim (which the API's own PlayToken authorization policy should already have made impossible by the time a handler runs) fails loudly instead of differently in five different handlers.</summary>
    public static Guid GetPlayerId(ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirst(PlayerId)?.Value ?? throw new InvalidOperationException("No play_player_id claim on an endpoint behind the PlayToken policy."));
}

/// <summary>Secret backing <see cref="PlayTokenService"/>'s HMAC — a local-dev placeholder in appsettings.json, a real one from Key Vault/managed identity in any real environment (CLAUDE.md Section 4.7), same posture as <c>StripeWebhookOptions</c>.</summary>
public sealed record PlayTokenOptions(string Secret);

/// <summary>
/// Mints and verifies the opaque bearer token a published game's runtime
/// stores client-side (e.g. localStorage) to identify an anonymous
/// <see cref="Domain.Entities.Player"/> on every subsequent Play Services
/// call, without OpenIddict's full OIDC machinery — there's no login
/// form, no password, no human account here at all, just "this browser
/// has played before." Hand-rolled HMAC-SHA256 over
/// <c>{playerId}.{expiresAtUnixSeconds}</c>, the same self-contained,
/// no-external-dependency verification scheme
/// <c>Features.Billing.StripeWebhookEndpoint</c> already uses for Stripe
/// signatures — proven, understood, and it needs no new package.
///
/// Deliberately long-lived (<see cref="TokenLifetime"/>): unlike an
/// editor session, there's no login flow to silently refresh this from,
/// and losing it (a cleared browser, a new device) means genuinely
/// starting over as a new anonymous player — the same trade-off every
/// "local guest profile" system makes. There is no revocation
/// mechanism — a stated limitation, not an oversight: revoking one would
/// need a server-side denylist this MVP doesn't have, and the blast
/// radius of a leaked token is "someone can read/write one anonymous
/// player's own saves/scores," not account takeover.
/// </summary>
public sealed class PlayTokenService(PlayTokenOptions options)
{
    private static readonly TimeSpan TokenLifetime = TimeSpan.FromDays(365);

    public string Issue(Guid playerId)
    {
        var expiresAt = DateTimeOffset.UtcNow.Add(TokenLifetime).ToUnixTimeSeconds();
        var payload = $"{playerId:N}.{expiresAt}";
        return $"{payload}.{Sign(payload)}";
    }

    public bool TryValidate(string token, out Guid playerId)
    {
        playerId = default;

        var parts = token.Split('.');
        if (parts.Length != 3) return false;
        if (!Guid.TryParse(parts[0], out playerId)) return false;
        if (!long.TryParse(parts[1], out var expiresAt)) return false;
        if (DateTimeOffset.UtcNow.ToUnixTimeSeconds() > expiresAt) return false;

        var payload = $"{parts[0]}.{parts[1]}";
        var expected = Sign(payload);
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(parts[2]), Encoding.UTF8.GetBytes(expected));
    }

    private string Sign(string payload)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(options.Secret));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
    }
}
