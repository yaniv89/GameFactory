namespace Forge.Infrastructure.Email;

/// <summary>
/// Sends a transactional email. No implementation is wired to a real
/// production provider — CLAUDE.md Section 2.1's stack table doesn't pin
/// one (docs/SPEC.md Section 23.3 mentions Resend/SendGrid as "the
/// earlier cost discussion", not a decision), so picking one is a call
/// for the person paying the bill, not this session. Two implementations
/// exist for local use, chosen by whether <c>Smtp:Host</c> is configured
/// (<c>DependencyInjection.AddForgeAuth</c>): <see cref="LoggingEmailSender"/>
/// (the default — logs that mail would have been sent, sends nothing,
/// used by CI/Forge.Tests) so the signup/verification/password-reset
/// flows are real and testable end-to-end (the token is genuinely
/// generated and genuinely required) without silently pretending
/// delivery works; and <see cref="SmtpEmailSender"/>, real SMTP delivery
/// to a local Mailpit catcher for a human to actually read the mail.
/// </summary>
public interface IEmailSender
{
    Task SendAsync(string toEmail, string subject, string plainTextBody, CancellationToken cancellationToken);
}
