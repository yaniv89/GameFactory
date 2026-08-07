using Forge.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using OpenIddict.Abstractions;

namespace Forge.Api.Authorization;

/// <summary>
/// Resolves the domain <see cref="Forge.Domain.Entities.User"/> row for
/// the current request's authenticated principal, once, right after
/// authentication runs and before any endpoint executes — the one place
/// a client-supplied identifier is never trusted (CLAUDE.md Section 1.1
/// guardrail 4): the subject comes only from the validated access
/// token's `sub` claim, and the domain user id is looked up from that,
/// never accepted as a request parameter.
///
/// An authenticated token whose subject has no matching domain user row
/// (deleted account, or a row that failed to get created at signup) is
/// treated as unauthenticated rather than surfaced as an error here —
/// endpoints that require a domain user still see
/// <see cref="ICurrentUser.IsAuthenticated"/> as false and fail their own
/// authorization checks normally.
/// </summary>
public sealed class CurrentUserMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context, CurrentUser currentUser, ForgeDbContext db)
    {
        if (context.User.Identity?.IsAuthenticated == true)
        {
            var subjectClaim = context.User.FindFirst(OpenIddictConstants.Claims.Subject)?.Value;
            if (Guid.TryParse(subjectClaim, out var identitySubjectId))
            {
                var domainUserId = await db.Users
                    .Where(u => u.IdentitySubjectId == subjectClaim && u.DeletedAt == null)
                    .Select(u => (Guid?)u.Id)
                    .SingleOrDefaultAsync(context.RequestAborted);

                if (domainUserId is { } resolvedUserId)
                {
                    currentUser.IdentitySubjectId = identitySubjectId;
                    currentUser.UserId = resolvedUserId;
                    currentUser.IsAuthenticated = true;
                }
            }
        }

        await next(context);
    }
}
