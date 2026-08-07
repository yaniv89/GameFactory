using Microsoft.Extensions.Logging;

namespace Forge.Infrastructure.Email;

/// <summary>
/// Logs that an email would have been sent, instead of sending it. This is
/// a real, working implementation of <see cref="IEmailSender"/> for local
/// development and tests — not a stub standing in for a "real" one — but
/// it is NOT suitable for any environment with real users: nobody receives
/// this mail. CLAUDE.md guardrail 5 (never log secrets, tokens, or PII) is
/// why the body — which carries the actual verification/reset token, a
/// bearer credential — is never logged at any level, and the recipient
/// address is masked rather than logged raw (confirmed by CodeQL: an
/// earlier version logging the full body at Debug and the raw address at
/// Information was flagged as clear-text credential storage and exposure
/// of private information respectively). Forge.Tests' CapturingEmailSender
/// test double is the actual mechanism tests use to read a real generated
/// token; this class has no need to.
/// </summary>
public sealed class LoggingEmailSender(ILogger<LoggingEmailSender> logger) : IEmailSender
{
    public Task SendAsync(string toEmail, string subject, string plainTextBody, CancellationToken cancellationToken)
    {
        logger.LogInformation(
            "Email (not actually sent — no provider configured): to={MaskedRecipient} subject={Subject}",
            MaskEmail(toEmail), subject);
        return Task.CompletedTask;
    }

    private static string MaskEmail(string email)
    {
        var atIndex = email.IndexOf('@');
        if (atIndex <= 0) return "***";
        return $"{email[0]}***{email[atIndex..]}";
    }
}
