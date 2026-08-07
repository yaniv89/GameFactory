using Forge.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;

namespace Forge.Api.Features.Auth;

public sealed record LoginRequest(string Email, string Password);

/// <summary>
/// Establishes the Identity application cookie the SPA needs before it
/// can navigate to <c>/connect/authorize</c> (docs/SPEC.md Section 23.3
/// step 3) — this endpoint is the login *form's* target, not the OIDC
/// flow itself. Uniform 401 on any failure (no such account, wrong
/// password, locked out) — which of those is true is not this endpoint's
/// signal to give away.
/// </summary>
public static class LoginEndpoint
{
    public static IEndpointRouteBuilder MapLogin(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/auth/login", Handle)
            .WithName("Login")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status401Unauthorized);
        return app;
    }

    private static async Task<IResult> Handle(
        LoginRequest req,
        SignInManager<ForgeIdentityUser> signInManager,
        UserManager<ForgeIdentityUser> userManager)
    {
        var identityUser = await userManager.FindByEmailAsync(req.Email);
        if (identityUser is null)
        {
            return InvalidCredentialsProblem();
        }

        var result = await signInManager.PasswordSignInAsync(identityUser, req.Password, isPersistent: false, lockoutOnFailure: true);
        if (!result.Succeeded)
        {
            return InvalidCredentialsProblem();
        }

        return TypedResults.NoContent();
    }

    private static IResult InvalidCredentialsProblem() => TypedResults.Problem(
        title: "Invalid email or password",
        detail: "Check your credentials and try again.",
        statusCode: StatusCodes.Status401Unauthorized);
}
