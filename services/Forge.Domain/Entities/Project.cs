namespace Forge.Domain.Entities;

/// <summary>
/// A game project (docs/SPEC.md Section 6.2). The project document tree
/// itself lives in <see cref="ProjectRevision.Doc"/>, not on this row —
/// this row only tracks identity, visibility, and which revision is
/// current. <see cref="HeadRevision"/> is the optimistic-concurrency
/// token the CommitRevision endpoint (Section 13.3) checks on every write.
/// </summary>
public sealed class Project
{
    public Guid Id { get; set; }

    public Guid WorkspaceId { get; set; }

    /// <summary>Unique within the workspace, not globally.</summary>
    public required string Slug { get; set; }

    public required string Title { get; set; }

    public string? Description { get; set; }

    public string GenreTemplate { get; set; } = "topdown-rpg";

    /// <summary>Semver of the Forge runtime this project targets.</summary>
    public required string EngineVersion { get; set; }

    /// <summary>private | unlisted | public.</summary>
    public string Visibility { get; set; } = "private";

    /// <summary>Null until the first revision is committed.</summary>
    public long? HeadRevision { get; set; }

    public Guid? CoverAssetId { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public DateTimeOffset? DeletedAt { get; set; }

    public Workspace? Workspace { get; set; }

    public ICollection<ProjectRevision> Revisions { get; set; } = new List<ProjectRevision>();
}

/// <summary>The closed set of <see cref="Project.Visibility"/> values.</summary>
public static class ProjectVisibility
{
    public const string Private = "private";
    public const string Unlisted = "unlisted";
    public const string Public = "public";
}
