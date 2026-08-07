namespace Forge.Domain.Entities;

/// <summary>
/// A billing and access-control boundary (docs/SPEC.md Section 6.2). Every
/// authorization decision in the API resolves down to "does the current
/// user's token subject have a <see cref="WorkspaceMember"/> row on this
/// workspace" — never a client-supplied workspace ID taken on trust
/// (CLAUDE.md Section 1.1 guardrail 4).
/// </summary>
public sealed class Workspace
{
    public Guid Id { get; set; }

    public required string Slug { get; set; }

    public required string Name { get; set; }

    /// <summary>free | pro | studio — see docs/SPEC.md Section 23.2 for what each gates.</summary>
    public string Plan { get; set; } = "free";

    public int SeatLimit { get; set; } = 1;

    public int StorageQuotaMb { get; set; } = 500;

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }

    public ICollection<WorkspaceMember> Members { get; set; } = new List<WorkspaceMember>();

    public ICollection<Project> Projects { get; set; } = new List<Project>();
}
