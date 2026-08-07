using Microsoft.Extensions.Logging;

namespace Forge.Infrastructure.Email;

/// <summary>
/// Logs the email instead of sending it. This is a real, working
/// implementation of <see cref="IEmailSender"/> for local development and
/// tests — not a stub standing in for a "real" one — but it is NOT
/// suitable for any environment with real users: nobody receives this
/// mail. CLAUDE.md guardrail 5 (never log secrets) is why only the
/// subject and recipient are logged at Information level; the body
/// (which contains the actual verification/reset token — a bearer
/// credential) is logged at Debug, which production logging
/// configuration should never enable for this category.
/// </summary>
public sealed class LoggingEmailSender(ILogger<LoggingEmailSender> logger) : IEmailSender
{
    public Task SendAsync(string toEmail, string subject, string plainTextBody, CancellationToken cancellationToken)
    {
        logger.LogInformation("Email (not actually sent — no provider configured): to={ToEmail} subject={Subject}", toEmail, subject);
        logger.LogDebug("Email body: {Body}", plainTextBody);
        return Task.CompletedTask;
    }
}
