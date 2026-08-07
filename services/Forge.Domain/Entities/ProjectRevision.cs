using System.Text.Json;

namespace Forge.Domain.Entities;

/// <summary>
/// An append-only entry in a project's revision log (docs/SPEC.md Section
/// 6.2, Section 13.3). The project document tree lives here, in
/// <see cref="Doc"/> — never mutated on <see cref="Project"/> directly.
/// <see cref="DocHash"/> is the sha256 of the serialized document, used
/// both for integrity and for the CommitRevision endpoint's
/// content-addressed dedupe (an unchanged document commit is a no-op).
/// </summary>
public sealed class ProjectRevision
{
    public long Id { get; set; }

    public Guid ProjectId { get; set; }

    /// <summary>Null for the first revision of a project.</summary>
    public long? ParentId { get; set; }

    /// <summary>Null if the authoring user's account was later deleted.</summary>
    public Guid? AuthorId { get; set; }

    /// <summary>User-supplied checkpoint name.</summary>
    public string? Label { get; set; }

    /// <summary>The full ProjectDocument (docs/SPEC.md Section 7), stored as jsonb.</summary>
    public required JsonElement Doc { get; set; }

    /// <summary>sha256 of the serialized <see cref="Doc"/>.</summary>
    public required byte[] DocHash { get; set; }

    public int SizeBytes { get; set; }

    public bool IsCheckpoint { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public Project? Project { get; set; }

    public User? Author { get; set; }
}
