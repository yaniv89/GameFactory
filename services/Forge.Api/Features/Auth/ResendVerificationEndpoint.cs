using Forge.Infrastructure.Email;
using Forge.Infrastructure.Identity;
using Microsoft.AspNetCore.Identity;

namespace Forge.Api.Features.Auth;

public sealed record ResendVerificationRequest(string Email);

/// <summary>
/// Always responds 202 regardless of whether the email exists or is
/// already verified — an oracle that confirmed account existence here
/// would make this endpoint a free email-enumeration tool. The real
/// signal (whether an email actually went out) is only ever observable
/// by the account holder, in their inbox.
/// </summary>
public static class ResendVerificationEndpoint
{
    public static IEndpointRouteBuilder MapResendVerification(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/v1/auth/resend-verification", Handle)
            .WithName("ResendVerification")
            .Produces(StatusCodes.Status202Accepted);
        return app;
    }

    private static async Task<IResult> Handle(
        ResendVerificationRequest req,
        UserManager<ForgeIdentityUser> userManager,
        IEmailSender emailSender,
        CancellationToken ct)
    {
        var identityUser = await userManager.FindByEmailAsync(req.Email);
        if (identityUser is not null && !await userManager.IsEmailConfirmedAsync(identityUser))
        {
            var token = await userManager.GenerateEmailConfirmationTokenAsync(identityUser);
            await emailSender.SendAsync(req.Email, "Verify your Forge account", $"Verification token: {token}", ct);
        }

        return TypedResults.Accepted((string?)null);
    }
}
