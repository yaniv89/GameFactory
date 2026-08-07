namespace Forge.Api.Authorization;

/// <summary>
/// The mutable, request-scoped backing store for <see cref="ICurrentUser"/> —
/// only <see cref="CurrentUserMiddleware"/> writes to it. Registered as
/// itself (concrete type) so the middleware can resolve and mutate it,
/// and separately as <see cref="ICurrentUser"/> (read-only surface) for
/// everything else.
/// </summary>
public sealed class CurrentUser : ICurrentUser
{
    public bool IsAuthenticated { get; internal set; }

    private Guid? _userId;
    private Guid? _identitySubjectId;

    public Guid UserId
    {
        get => _userId ?? throw new InvalidOperationException("No authenticated domain user for this request.");
        internal set => _userId = value;
    }

    public Guid IdentitySubjectId
    {
        get => _identitySubjectId ?? throw new InvalidOperationException("No authenticated identity subject for this request.");
        internal set => _identitySubjectId = value;
    }
}
