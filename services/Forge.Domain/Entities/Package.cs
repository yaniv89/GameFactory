namespace Forge.Domain.Entities;

/// <summary>
/// A registry package — a Module, an Art Pack, or a project template
/// (docs/SPEC.md Section 6.2). The package row itself is just identity
/// and listing metadata; every actual publishable artifact is a
/// <see cref="PackageVersion"/> underneath it.
/// </summary>
public sealed class Package
{
    public Guid Id { get; set; }

    /// <summary>Scoped, e.g. <c>@acme/farming</c>. Globally unique across every kind.</summary>
    public required string Name { get; set; }

    public required string Kind { get; set; }

    public Guid AuthorUserId { get; set; }

    public required string DisplayName { get; set; }

    public required string Summary { get; set; }

    public string? ReadmeMarkdown { get; set; }

    public string? HomepageUrl { get; set; }

    /// <summary>SPDX license identifier, e.g. <c>MIT</c>.</summary>
    public required string LicenseSpdx { get; set; }

    public bool IsDeprecated { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public User? Author { get; set; }

    public ICollection<PackageVersion> Versions { get; set; } = new List<PackageVersion>();

    /// <summary>F1 — docs/SPEC.md Section 16.2's ratings/reviews subsystem. See <see cref="Review"/>'s own doc comment.</summary>
    public ICollection<Review> Reviews { get; set; } = new List<Review>();

    /// <summary>The minimal issue tracker backing <see cref="Marketplace.ListingQualitySignals.SupportResponsivenessHours"/>. See <see cref="PackageIssue"/>'s own doc comment.</summary>
    public ICollection<PackageIssue> Issues { get; set; } = new List<PackageIssue>();
}

/// <summary>The closed set of <see cref="Package.Kind"/> values.</summary>
public static class PackageKind
{
    public const string Module = "module";
    public const string ArtPack = "artpack";
    public const string Template = "template";

    public static readonly IReadOnlySet<string> All = new HashSet<string>([Module, ArtPack, Template]);
}
