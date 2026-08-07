using Forge.Infrastructure.Identity;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using OpenIddict.Abstractions;
using OpenIddict.Server.AspNetCore;

namespace Forge.Api.Features.Auth;

/// <summary>
/// The OIDC authorization endpoint (docs/SPEC.md Section 13.2). No
/// server-rendered login page or consent screen exists — the editor SPA
/// owns the login form (CLAUDE.md Section 2.2) and calls
/// <c>POST /api/v1/auth/login</c> itself first, which establishes the
/// Identity application cookie this endpoint checks. Auto-approves any
/// authenticated request rather than showing a consent screen: this is a
/// trusted first-party client issuing tokens for its own resource
/// server, not a third-party OAuth integration.
/// </summary>
public static class AuthorizationEndpoint
{
    public static IEndpointRouteBuilder MapAuthorize(this IEndpointRouteBuilder app)
    {
        app.MapMethods("/connect/authorize", ["GET", "POST"], Handle)
            .RequireAuthorization(policy => policy
                .AddAuthenticationSchemes(IdentityConstants.ApplicationScheme)
                .RequireAuthenticatedUser());
        return app;
    }

    private static async Task<IResult> Handle(HttpContext httpContext, UserManager<ForgeIdentityUser> userManager)
    {
        var request = httpContext.GetOpenIddictServerRequest()
            ?? throw new InvalidOperationException("The OpenIddict request cannot be retrieved.");

        var identityUser = await userManager.GetUserAsync(httpContext.User);
        if (identityUser is null)
        {
            return TypedResults.Challenge(authenticationSchemes: [IdentityConstants.ApplicationScheme]);
        }

        var principal = OpenIddictClaimsFactory.CreatePrincipal(identityUser, request.GetScopes());
        return TypedResults.SignIn(principal, authenticationScheme: OpenIddictServerAspNetCoreDefaults.AuthenticationScheme);
    }
}
