namespace Forge.Api.Authorization;

/// <summary>
/// The authenticated request's domain identity, resolved once per request
/// by <see cref="CurrentUserMiddleware"/> — endpoint handlers read it
/// synchronously (matching docs/SPEC.md Section 13.3's CommitRevision
/// sample, which uses <c>currentUser.UserId</c> directly) rather than
/// re-querying <see cref="Forge.Domain.Entities.User"/> themselves on every
/// access.
/// </summary>
public interface ICurrentUser
{
    bool IsAuthenticated { get; }

    /// <summary>The domain <see cref="Forge.Domain.Entities.User"/> row's Id — NOT the OpenIddict/Identity subject. Throws if not authenticated.</summary>
    Guid UserId { get; }

    /// <summary>The token's `sub` claim (Identity's own user id). Throws if not authenticated.</summary>
    Guid IdentitySubjectId { get; }
}
