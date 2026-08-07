namespace Forge.Domain.Entities;

/// <summary>
/// A workspace member's role (docs/SPEC.md Section 6.2's <c>workspace_members.role</c>).
/// Kept as a closed set of named constants rather than a free-form string
/// scattered across authorization policies, so "what roles exist" has one
/// source of truth.
/// </summary>
public static class WorkspaceRole
{
    public const string Owner = "owner";
    public const string Admin = "admin";
    public const string Editor = "editor";
    public const string Viewer = "viewer";

    public static readonly IReadOnlySet<string> All = new HashSet<string>([Owner, Admin, Editor, Viewer]);
}
