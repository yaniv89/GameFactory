namespace Forge.Tests;

/// <summary>
/// Resolves paths into the repo relative to its root, found by walking
/// up from the test assembly's own location looking for <c>Forge.sln</c>
/// — needed by any test that reaches across the language boundary into
/// <c>packages/</c> (currently: SmokeRunGate's real, built
/// packages/runtime-host smoke-run CLI, docs/SPEC.md Section 10.4 gate
/// 4). Both local runs and CI check out the whole monorepo, so this
/// marker is always present relative to wherever the test binaries land.
/// </summary>
public static class RepoPaths
{
    public static string Resolve(string relativePath)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Forge.sln")))
        {
            dir = dir.Parent;
        }
        if (dir is null)
        {
            throw new InvalidOperationException(
                $"RepoPaths.Resolve: could not find Forge.sln by walking up from '{AppContext.BaseDirectory}' — is the test assembly running from inside a checkout of the repo?");
        }
        return Path.Combine(dir.FullName, relativePath);
    }
}
