using Forge.Domain.Entities;
using Forge.Infrastructure.Identity;
using Forge.Infrastructure.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Forge.Api.Features.Auth;

public sealed record VerifyEmailRequest(string Email, string Token);

/// <summary>
/// docs/SPEC.md Section 23.3 step 2: consumes the signed, single-use,
/// 24-hour token from Identity's own data-protection token provider — no
/// separate tokens table. Sets both Identity's own confirmation flag and
/// the domain row's <see cref="User.EmailVerifiedAt"/>, since Section
/// 16.3/23.3 gate on the latter, not Identity's internal state.
/// </summary>
public static class VerifyEmailEndpoint
{
    public static IEndpointRouteBuilder MapVerifyEmail(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/auth/verify-email", Handle)
            .WithName("VerifyEmail")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status400BadRequest);
        return app;
    }

    private static async Task<IResult> Handle(
        VerifyEmailRequest req,
        UserManager<ForgeIdentityUser> userManager,
        ForgeDbContext db,
        CancellationToken ct)
    {
        var identityUser = await userManager.FindByEmailAsync(req.Email);
        if (identityUser is null)
        {
            return InvalidTokenProblem();
        }

        var result = await userManager.ConfirmEmailAsync(identityUser, req.Token);
        if (!result.Succeeded)
        {
            return InvalidTokenProblem();
        }

        await db.Users
            .Where(u => u.IdentitySubjectId == identityUser.Id.ToString())
            .ExecuteUpdateAsync(s => s
                .SetProperty(u => u.EmailVerifiedAt, DateTimeOffset.UtcNow)
                .SetProperty(u => u.UpdatedAt, DateTimeOffset.UtcNow), ct);

        return TypedResults.NoContent();
    }

    private static IResult InvalidTokenProblem() => TypedResults.Problem(
        title: "Verification link is invalid or has expired",
        detail: "Request a new verification email and try again.",
        statusCode: StatusCodes.Status400BadRequest);
}
