using Forge.Api.RateLimiting;
using Forge.Infrastructure.Identity;
using Microsoft.AspNetCore; // GetOpenIddictServerRequest() — OpenIddictServerAspNetCoreHelpers lives here, not in OpenIddict.Server.AspNetCore.
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using OpenIddict.Abstractions;
using OpenIddict.Server.AspNetCore;
using static OpenIddict.Abstractions.OpenIddictConstants;

namespace Forge.Api.Features.Auth;

/// <summary>
/// The OIDC token endpoint (docs/SPEC.md Section 13.2): exchanges the
/// authorization code (PKCE-verified by OpenIddict's own middleware
/// before this handler ever runs) or a refresh token for an access
/// token. Both grants end the same way — reissuing a fresh principal via
/// <see cref="OpenIddictClaimsFactory"/> rather than replaying whatever
/// claims were embedded in the code/refresh token, so a refresh reflects
/// the account's current state.
/// </summary>
public static class TokenEndpoint
{
    public static IEndpointRouteBuilder MapToken(this IEndpointRouteBuilder app)
    {
        app.MapPost("/connect/token", Handle)
            .WithRateLimit("token", RateLimitKeyStrategy.IpAddress, RateLimitPolicies.Token);
        return app;
    }

    private static async Task<IResult> Handle(HttpContext httpContext, UserManager<ForgeIdentityUser> userManager)
    {
        var request = httpContext.GetOpenIddictServerRequest()
            ?? throw new InvalidOperationException("The OpenIddict request cannot be retrieved.");

        if (!request.IsAuthorizationCodeGrantType() && !request.IsRefreshTokenGrantType())
        {
            return TypedResults.Problem(
                title: Errors.UnsupportedGrantType,
                statusCode: StatusCodes.Status400BadRequest);
        }

        // The principal OpenIddict already decrypted and validated from
        // the code/refresh token it was handed — its Subject claim is
        // this API's own (see OpenIddictClaimsFactory), not Identity's
        // default NameIdentifier claim type, so the lookup goes through
        // FindByIdAsync directly rather than UserManager.GetUserAsync
        // (which assumes the latter).
        var authenticateResult = await httpContext.AuthenticateAsync(OpenIddictServerAspNetCoreDefaults.AuthenticationScheme);
        var subject = authenticateResult.Principal?.GetClaim(Claims.Subject);
        var identityUser = subject is not null ? await userManager.FindByIdAsync(subject) : null;

        if (identityUser is null)
        {
            return TypedResults.Problem(
                title: Errors.InvalidGrant,
                detail: "The token is no longer valid.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        var scopes = authenticateResult.Principal!.GetScopes();
        var principal = OpenIddictClaimsFactory.CreatePrincipal(identityUser, scopes);
        return TypedResults.SignIn(principal, authenticationScheme: OpenIddictServerAspNetCoreDefaults.AuthenticationScheme);
    }
}
