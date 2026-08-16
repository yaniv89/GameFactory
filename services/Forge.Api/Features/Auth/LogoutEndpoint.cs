using Forge.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;
using OpenIddict.Abstractions;

namespace Forge.Api.Features.Auth;

/// <summary>
/// docs/SPEC.md Section 23.3 step 4: revokes the refresh token
/// server-side and clears the cookie — never a client-side-only token
/// discard, since a stolen refresh token must actually stop working, not
/// just get forgotten by the browser that logged out (CLAUDE.md Section
/// 4.7 of the brief). <c>UseReferenceRefreshTokens()</c> (Forge.Infrastructure's
/// OpenIddict config) is what makes revocation here actually mean
/// something: the token string the client holds is a server-side lookup
/// key, not a self-contained JWT nothing can invalidate early.
///
/// No request body: the refresh token lives in the httpOnly
/// <see cref="RefreshTokenCookie"/>, set by the same OpenIddict event
/// handlers (<c>DependencyInjection.AddForgeAuth</c>) that put it there in
/// the first place — client JS never holds the value to send it, by
/// design.
/// </summary>
public static class LogoutEndpoint
{
    public static IEndpointRouteBuilder MapLogout(this IEndpointRouteBuilder app)
    {
        app.MapPost("/connect/logout", Handle)
            .WithName("Logout")
            .Produces(StatusCodes.Status204NoContent);
        return app;
    }

    private static async Task<IResult> Handle(
        HttpContext httpContext,
        SignInManager<ForgeIdentityUser> signInManager,
        IOpenIddictTokenManager tokenManager,
        IHostEnvironment environment,
        CancellationToken ct)
    {
        await signInManager.SignOutAsync();

        if (httpContext.Request.Cookies.TryGetValue(RefreshTokenCookie.Name, out var refreshToken) && !string.IsNullOrEmpty(refreshToken))
        {
            var token = await tokenManager.FindByReferenceIdAsync(refreshToken, ct);
            if (token is not null)
            {
                await tokenManager.TryRevokeAsync(token, ct);
            }
        }

        httpContext.Response.Cookies.Delete(RefreshTokenCookie.Name, RefreshTokenCookie.BuildOptions(environment.IsDevelopment()));

        return TypedResults.NoContent();
    }
}
