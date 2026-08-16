namespace Forge.Infrastructure.Email;

/// <summary>Local SMTP sink configuration (Mailpit in docker-compose.yml) — see <see cref="SmtpEmailSender"/>.</summary>
public sealed record SmtpOptions(string Host, int Port, string FromAddress);
