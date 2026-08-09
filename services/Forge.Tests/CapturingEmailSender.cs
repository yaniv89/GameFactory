using Forge.Infrastructure.Email;

namespace Forge.Tests;

/// <summary>
/// Test double for <see cref="IEmailSender"/> — captures what would have
/// been sent instead of sending it, so tests can retrieve the real
/// verification/reset token the endpoint under test actually generated
/// (LoggingEmailSender only writes it to a logger, not retrievable by a
/// test) without special-casing signup/reset to bypass the HTTP layer.
/// </summary>
public sealed class CapturingEmailSender : IEmailSender
{
    private readonly List<(string ToEmail, string Subject, string Body)> _sent = [];

    public IReadOnlyList<(string ToEmail, string Subject, string Body)> Sent
    {
        get
        {
            lock (_sent) return [.. _sent];
        }
    }

    public Task SendAsync(string toEmail, string subject, string plainTextBody, CancellationToken cancellationToken)
    {
        lock (_sent) _sent.Add((toEmail, subject, plainTextBody));
        return Task.CompletedTask;
    }
}
