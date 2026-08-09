namespace Forge.Infrastructure.Email;

/// <summary>
/// Sends a transactional email. No implementation is wired to a real
/// provider yet — CLAUDE.md Section 2.1's stack table doesn't pin one
/// (docs/SPEC.md Section 23.3 mentions Resend/SendGrid as "the earlier
/// cost discussion", not a decision), so picking one is a call for the
/// person paying the bill, not this session. <see cref="LoggingEmailSender"/>
/// is the only implementation registered right now, and it does not send
/// mail — it exists so the signup/verification/password-reset flows are
/// real and testable end-to-end (the token is genuinely generated and
/// genuinely required) without silently pretending delivery works.
/// </summary>
public interface IEmailSender
{
    Task SendAsync(string toEmail, string subject, string plainTextBody, CancellationToken cancellationToken);
}
