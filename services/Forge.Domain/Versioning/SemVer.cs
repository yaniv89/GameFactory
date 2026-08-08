using System.Text.RegularExpressions;

namespace Forge.Domain.Versioning;

/// <summary>
/// A parsed Semantic Versioning 2.0.0 version (https://semver.org) —
/// major.minor.patch plus an optional dot-separated prerelease identifier
/// list, comparable per the spec's own precedence rules (numeric
/// identifiers compare numerically, alphanumeric ones lexically, a
/// prerelease version always sorts before its release equivalent). Build
/// metadata (the optional <c>+...</c> suffix) is parsed but never affects
/// comparison, per spec.
///
/// docs/SPEC.md Section 7.6/13.4: every package version in the registry
/// (<see cref="Entities.PackageVersion.Version"/>) and every dependency
/// range it declares is built on this.
/// </summary>
public sealed class SemVer : IComparable<SemVer>, IEquatable<SemVer>
{
    private static readonly Regex Pattern = new(
        @"^(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<prerelease>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+(?<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$",
        RegexOptions.Compiled);

    public int Major { get; }
    public int Minor { get; }
    public int Patch { get; }

    /// <summary>Dot-separated identifiers after the <c>-</c>, in order. Empty for a release version.</summary>
    public IReadOnlyList<string> Prerelease { get; }

    public SemVer(int major, int minor, int patch, IReadOnlyList<string>? prerelease = null)
    {
        Major = major;
        Minor = minor;
        Patch = patch;
        Prerelease = prerelease ?? [];
    }

    public bool IsPrerelease => Prerelease.Count > 0;

    public static bool TryParse(string input, out SemVer? version)
    {
        version = null;
        var match = Pattern.Match(input.Trim());
        if (!match.Success) return false;

        var prerelease = match.Groups["prerelease"].Success
            ? match.Groups["prerelease"].Value.Split('.')
            : [];

        version = new SemVer(
            int.Parse(match.Groups["major"].Value),
            int.Parse(match.Groups["minor"].Value),
            int.Parse(match.Groups["patch"].Value),
            prerelease);
        return true;
    }

    public static SemVer Parse(string input) =>
        TryParse(input, out var version) ? version! : throw new FormatException($"'{input}' is not a valid semantic version.");

    public int CompareTo(SemVer? other)
    {
        if (other is null) return 1;

        var core = Major.CompareTo(other.Major);
        if (core != 0) return core;
        core = Minor.CompareTo(other.Minor);
        if (core != 0) return core;
        core = Patch.CompareTo(other.Patch);
        if (core != 0) return core;

        // A release version outranks any of its own prereleases (1.0.0 > 1.0.0-rc.1).
        if (!IsPrerelease && !other.IsPrerelease) return 0;
        if (!IsPrerelease) return 1;
        if (!other.IsPrerelease) return -1;

        return ComparePrereleaseIdentifiers(Prerelease, other.Prerelease);
    }

    private static int ComparePrereleaseIdentifiers(IReadOnlyList<string> a, IReadOnlyList<string> b)
    {
        var length = Math.Min(a.Count, b.Count);
        for (var i = 0; i < length; i++)
        {
            var result = CompareIdentifier(a[i], b[i]);
            if (result != 0) return result;
        }
        // Fewer identifiers with an otherwise-equal prefix sorts first (1.0.0-alpha < 1.0.0-alpha.1).
        return a.Count.CompareTo(b.Count);
    }

    private static int CompareIdentifier(string a, string b)
    {
        var aIsNumeric = a.All(char.IsAsciiDigit);
        var bIsNumeric = b.All(char.IsAsciiDigit);

        // Numeric identifiers always sort lower than alphanumeric ones.
        if (aIsNumeric && bIsNumeric) return long.Parse(a).CompareTo(long.Parse(b));
        if (aIsNumeric) return -1;
        if (bIsNumeric) return 1;
        return string.CompareOrdinal(a, b);
    }

    public bool Equals(SemVer? other) => other is not null && CompareTo(other) == 0;
    public override bool Equals(object? obj) => obj is SemVer other && Equals(other);
    public override int GetHashCode() => HashCode.Combine(Major, Minor, Patch, string.Join('.', Prerelease));

    public static bool operator <(SemVer left, SemVer right) => left.CompareTo(right) < 0;
    public static bool operator >(SemVer left, SemVer right) => left.CompareTo(right) > 0;
    public static bool operator <=(SemVer left, SemVer right) => left.CompareTo(right) <= 0;
    public static bool operator >=(SemVer left, SemVer right) => left.CompareTo(right) >= 0;
    public static bool operator ==(SemVer? left, SemVer? right) => left is null ? right is null : left.Equals(right);
    public static bool operator !=(SemVer? left, SemVer? right) => !(left == right);

    public override string ToString() =>
        IsPrerelease ? $"{Major}.{Minor}.{Patch}-{string.Join('.', Prerelease)}" : $"{Major}.{Minor}.{Patch}";
}
