namespace Forge.Domain.Entities;

/// <summary>
/// docs/SPEC.md Section 17's "Player identity: PostgreSQL, anonymous by
/// default, optional account linking." A row is created the moment a
/// published game's runtime asks for a play identity — no signup, no
/// email — and stays anonymous forever unless
/// <see cref="LinkedUserId"/> is later set (M7 Phase 7's
/// <c>POST /api/v1/play/identity/link</c>). Platform-global, not scoped
/// to one project: the same anonymous player identity is reused across
/// every published game a browser plays, the same way a Steam or itch.io
/// guest profile isn't tied to a single title. Linking attributes this
/// specific device's play history to a real Forge account for
/// bookkeeping — it does not merge or unify save data from any other
/// anonymous identity the same person might have played under on a
/// different device, a stated simplification.
/// </summary>
public sealed class Player
{
    public Guid Id { get; set; }

    /// <summary>Set once this identity is linked to a real Forge account (<see cref="User"/>) — null forever for a purely anonymous player.</summary>
    public Guid? LinkedUserId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public User? LinkedUser { get; set; }
}
