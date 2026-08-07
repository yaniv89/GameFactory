using Forge.Infrastructure.Email;
using Forge.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;

namespace Forge.Api.Features.Auth;

public sealed record ForgotPasswordRequest(string Email);

public sealed record ResetPasswordRequest(string Email, string Token, string NewPassword);

/// <summary>
/// docs/SPEC.md Section 23.3 step 5: same signed-token mechanism as email
/// verification. Forgot-password always responds 202 regardless of
/// whether the account exists (same email-enumeration reasoning as
/// <see cref="ResendVerificationEndpoint"/>). Completing a reset
/// invalidates every other existing session by regenerating Identity's
/// security stamp, which is exactly what
/// <see cref="UserManager{TUser}.ResetPasswordAsync"/> does internally —
/// not something this endpoint has to do by hand.
/// </summary>
public static class PasswordEndpoints
{
    public static IEndpointRouteBuilder MapPasswordEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/auth/password/forgot", HandleForgot)
            .WithName("ForgotPassword")
            .Produces(StatusCodes.Status202Accepted);

        app.MapPost("/api/v1/auth/password/reset", HandleReset)
            .WithName("ResetPassword")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesValidationProblem();

        return app;
    }

    private static async Task<IResult> HandleForgot(
        ForgotPasswordRequest req,
        UserManager<ForgeIdentityUser> userManager,
        IEmailSender emailSender,
        CancellationToken ct)
    {
        var identityUser = await userManager.FindByEmailAsync(req.Email);
        if (identityUser is not null)
        {
            var token = await userManager.GeneratePasswordResetTokenAsync(identityUser);
            await emailSender.SendAsync(req.Email, "Reset your Forge password", $"Reset token: {token}", ct);
        }

        return TypedResults.Accepted((string?)null);
    }

    private static async Task<IResult> HandleReset(
        ResetPasswordRequest req,
        UserManager<ForgeIdentityUser> userManager,
        CancellationToken ct)
    {
        var identityUser = await userManager.FindByEmailAsync(req.Email);
        if (identityUser is null)
        {
            // Same token either way (real or fabricated) fails
            // ResetPasswordAsync's signature check — reject uniformly
            // rather than special-casing "no such account".
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["token"] = ["Reset link is invalid or has expired."],
            });
        }

        var result = await userManager.ResetPasswordAsync(identityUser, req.Token, req.NewPassword);
        if (!result.Succeeded)
        {
            return TypedResults.ValidationProblem(
                result.Errors
                    .GroupBy(e => e.Code)
                    .ToDictionary(g => g.Key, g => g.Select(e => e.Description).ToArray()));
        }

        return TypedResults.NoContent();
    }
}
