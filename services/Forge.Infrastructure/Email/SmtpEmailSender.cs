using System.Net.Mail;

namespace Forge.Infrastructure.Email;

/// <summary>
/// Sends real SMTP mail — not a production provider decision (see
/// <see cref="IEmailSender"/>'s own doc comment on why that's not this
/// session's call to make), but a genuine local-dev/test loop: points at
/// Mailpit (docker-compose.yml), a local SMTP catcher with a web UI at
/// http://localhost:8025 where a human can actually open the
/// verification/reset link <see cref="LoggingEmailSender"/> only ever
/// logged the existence of, never the content. Selected instead of
/// <see cref="LoggingEmailSender"/> only when <c>Smtp:Host</c> is
/// configured (see <c>DependencyInjection.AddForgeAuth</c>) — no config,
/// same log-only behavior as before, so CI/Forge.Tests (which never set
/// that key) are unaffected.
/// </summary>
public sealed class SmtpEmailSender(SmtpOptions options) : IEmailSender
{
    public async Task SendAsync(string toEmail, string subject, string plainTextBody, CancellationToken cancellationToken)
    {
        using var client = new SmtpClient(options.Host, options.Port);
        using var message = new MailMessage(options.FromAddress, toEmail, subject, plainTextBody);
        await client.SendMailAsync(message, cancellationToken);
    }
}
