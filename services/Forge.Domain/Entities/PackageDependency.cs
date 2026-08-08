namespace Forge.Domain.Entities;

/// <summary>
/// One declared dependency edge of a <see cref="PackageVersion"/>
/// (docs/SPEC.md Section 6.2) — composite-keyed on
/// (<see cref="VersionId"/>, <see cref="DependsOnName"/>) since a single
/// version declares at most one range per depended-on package name.
/// Consumed by <c>ResolveDependenciesEndpoint</c> (Section 13.4) to walk
/// the transitive dependency graph.
/// </summary>
public sealed class PackageDependency
{
    public Guid VersionId { get; set; }

    public required string DependsOnName { get; set; }

    /// <summary>See <see cref="Versioning.SemVerRange"/>.</summary>
    public required string VersionRange { get; set; }

    public bool IsOptional { get; set; }

    public PackageVersion? Version { get; set; }
}
