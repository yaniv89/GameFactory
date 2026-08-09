namespace Forge.Api.Features.Registry;

public sealed record ResolveRequest(
    string EngineVersion,
    Dictionary<string, string> Dependencies,
    Dictionary<string, string>? Pinned);

public sealed record ResolvedPackage(
    string Version,
    string Resolved,
    string Integrity,
    Dictionary<string, string> Dependencies);

public sealed record ResolveResponse(
    int LockfileVersion,
    string Engine,
    Dictionary<string, ResolvedPackage> Resolved,
    List<ResolutionWarning> Warnings);

public sealed record ResolutionWarning(string Package, string Kind, string Message);

/// <summary>The subset of a resolvable version's fields the resolver needs — never the full entity, so a cached copy can't carry EF change-tracking state.</summary>
internal sealed record PackageVersionDto(
    string Version,
    string EngineRange,
    string BundleUrl,
    byte[] BundleSha256,
    DateTimeOffset? YankedAt,
    Dictionary<string, string> Dependencies);

public sealed class PackageNotFoundException(string name) : Exception($"Package '{name}' does not exist or has no published, scanned versions.")
{
    public string Name { get; } = name;
}

public sealed class NoSatisfyingVersionException(string name, string range)
    : Exception($"No published version of '{name}' satisfies '{range}'.")
{
    public string Name { get; } = name;
    public string Range { get; } = range;
}

public sealed class InvalidRangeException(string name, string range)
    : Exception($"'{range}' requested for '{name}' is not a valid version range.")
{
    public string Name { get; } = name;
    public string Range { get; } = range;
}
