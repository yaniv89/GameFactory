using Microsoft.Extensions.Logging;

namespace Forge.Infrastructure.Email;

/// <summary>
/// Logs that an email would have been sent, instead of sending it. This is
/// a real, working implementation of <see cref="IEmailSender"/> for local
/// development and tests — not a stub standing in for a "real" one — but
/// it is NOT suitable for any environment with real users: nobody receives
/// this mail. CLAUDE.md guardrail 5 (never log secrets, tokens, or PII) is
/// why neither the body (the actual verification/reset token, a bearer
/// credential) nor the recipient address is logged at any level — a
/// masked form of the address was tried first, but CodeQL's dataflow
/// analysis still flags it, correctly: ASP.NET Identity marks
/// <c>Email</c> as <c>[PersonalData]</c>, and substring extraction isn't
/// a sanitizer, it's still a flow from that source into a log sink.
/// Dropping the recipient from the log line entirely is the actual fix,
/// not a suppression. Forge.Tests' CapturingEmailSender test double is
/// the mechanism tests use to read a real generated token; this class has
/// no need to.
/// </summary>
public sealed class LoggingEmailSender(ILogger<LoggingEmailSender> logger) : IEmailSender
{
    public Task SendAsync(string toEmail, string subject, string plainTextBody, CancellationToken cancellationToken)
    {
        logger.LogInformation(
            "Email (not actually sent — no provider configured): subject={Subject}", subject);
        return Task.CompletedTask;
    }
}
