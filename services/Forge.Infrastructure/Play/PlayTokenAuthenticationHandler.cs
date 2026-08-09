using System.Security.Claims;
using System.Text.Encodings.Web;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;

namespace Forge.Infrastructure.Play;

/// <summary>
/// A second, independent authentication scheme alongside OpenIddict's
/// Bearer validation (<c>AddForgeAuth</c>) — registered under its own
/// name so the two never collide: an endpoint opts into exactly one via
/// its own authorization policy's <c>AddAuthenticationSchemes</c>, the
/// same explicit-binding discipline <c>ForgeAuthorizationExtensions</c>'s
/// own doc comment already requires ("leaving that unstated would fall
/// back to the default authentication scheme"). Reads
/// <c>Authorization: PlayToken &lt;token&gt;</c> specifically — a
/// distinct scheme prefix from <c>Bearer</c>, so a request can never be
/// ambiguously valid against both at once.
/// </summary>
public sealed class PlayTokenAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    PlayTokenService tokenService)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    public const string SchemeName = "PlayToken";
    private const string HeaderPrefix = "PlayToken ";

    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();
        if (!header.StartsWith(HeaderPrefix, StringComparison.Ordinal))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var token = header[HeaderPrefix.Length..].Trim();
        if (!tokenService.TryValidate(token, out var playerId))
        {
            return Task.FromResult(AuthenticateResult.Fail("Invalid or expired play token."));
        }

        var identity = new ClaimsIdentity([new Claim(PlayClaimTypes.PlayerId, playerId.ToString())], SchemeName);
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
