namespace Forge.Domain.Entities;

/// <summary>
/// Join row granting a <see cref="User"/> a role on a <see cref="Workspace"/>
/// (docs/SPEC.md Section 6.2). Composite primary key (WorkspaceId, UserId) —
/// see <see cref="WorkspaceRole"/> for the closed set of role values.
/// </summary>
public sealed class WorkspaceMember
{
    public Guid WorkspaceId { get; set; }

    public Guid UserId { get; set; }

    public required string Role { get; set; }

    public DateTimeOffset JoinedAt { get; set; }

    public Workspace? Workspace { get; set; }

    public User? User { get; set; }
}
