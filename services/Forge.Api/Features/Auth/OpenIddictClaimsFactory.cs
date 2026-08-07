using System.Collections.Immutable;
using System.Security.Claims;
using Forge.Infrastructure;
using Forge.Infrastructure.Identity;
using OpenIddict.Abstractions;
using static OpenIddict.Abstractions.OpenIddictConstants;

namespace Forge.Api.Features.Auth;

/// <summary>
/// Builds the claims principal OpenIddict issues tokens from — shared by
/// the authorization endpoint (fresh login) and the token endpoint's
/// refresh-token grant (reissue), so a user's claims are computed the
/// same way regardless of which one produced the token. Deliberately
/// re-derives claims from the current <see cref="ForgeIdentityUser"/> row
/// every time rather than ever trusting a claim carried over from an
/// older token — a refreshed token reflects the account's current state,
/// not whatever was true when the user first logged in.
/// </summary>
public static class OpenIddictClaimsFactory
{
    public static ClaimsPrincipal CreatePrincipal(ForgeIdentityUser user, ImmutableArray<string> scopes)
    {
        var identity = new ClaimsIdentity(
            authenticationType: FederationAuthenticationType,
            nameType: Claims.Name,
            roleType: Claims.Role);

        identity.SetClaim(Claims.Subject, user.Id.ToString());
        identity.SetClaim(Claims.Email, user.Email);
        identity.SetClaim(Claims.Name, user.UserName);

        var principal = new ClaimsPrincipal(identity);
        principal.SetScopes(scopes);
        principal.SetResources(DependencyInjection.ApiScope);

        foreach (var claim in principal.Claims)
        {
            claim.SetDestinations(GetDestinations(claim, principal));
        }

        return principal;
    }

    // Matches OpenIddict's own documented sample (Claims.Subject/Name
    // always go in both tokens; Email only reaches the identity token
    // when the "email" scope was actually granted, per OIDC's own scope
    // semantics — everything else defaults to access-token-only).
    private static IEnumerable<string> GetDestinations(Claim claim, ClaimsPrincipal principal)
    {
        switch (claim.Type)
        {
            case var type when type == Claims.Name || type == Claims.Subject:
                yield return Destinations.AccessToken;
                yield return Destinations.IdentityToken;
                break;

            case var type when type == Claims.Email:
                yield return Destinations.AccessToken;
                if (principal.HasScope(Scopes.Email))
                {
                    yield return Destinations.IdentityToken;
                }
                break;

            default:
                yield return Destinations.AccessToken;
                break;
        }
    }

    // Just a label identifying how this identity was produced — any
    // non-empty string makes ClaimsIdentity.IsAuthenticated true.
    // "AuthenticationTypes.Federation" matches
    // Microsoft.IdentityModel.Tokens.TokenValidationParameters'
    // DefaultAuthenticationType (OpenIddict's own samples use that
    // constant directly); spelled out here to avoid pulling in that
    // package for one string.
    private const string FederationAuthenticationType = "AuthenticationTypes.Federation";
}
