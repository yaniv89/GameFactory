namespace Forge.Functions.Scan.SmokeGate;

/// <summary>Configuration for <see cref="SmokeRunGate"/> — bound from <c>SmokeGate:*</c> configuration, same convention as the rest of the repo's typed-options classes. A record (not a plain class) specifically so tests can derive a variant via `with` (e.g. a bad NodeExecutablePath) without hand-copying every other field.</summary>
public sealed record SmokeGateOptions
{
    public const string SectionName = "SmokeGate";

    /// <summary>Defaults to relying on PATH resolution — real deployments and CI both have a real Node on PATH; only ever overridden in a test that needs a specific binary.</summary>
    public string NodeExecutablePath { get; init; } = "node";

    /// <summary>Absolute path to packages/runtime-host/dist/smoke/cli.bundle.mjs. No default — this is real deployment/test configuration, not something safe to guess at.</summary>
    public required string CliBundlePath { get; init; }

    /// <summary>docs/SPEC.md Section 10.4: "a hard 60 second timeout."</summary>
    public int TimeoutSeconds { get; init; } = 60;
}
