namespace Forge.Functions.Build;

/// <summary>Configuration for <see cref="BuildRunner"/> — bound from <c>BuildRunner:*</c> configuration, same convention as <c>Forge.Functions.Scan.SmokeGate.SmokeGateOptions</c>. A record so tests can derive a variant via `with` without hand-copying every other field.</summary>
public sealed record BuildRunnerOptions
{
    public const string SectionName = "BuildRunner";

    /// <summary>Defaults to relying on PATH resolution — real deployments and CI both have a real Node on PATH; only ever overridden in a test that needs a specific binary.</summary>
    public string NodeExecutablePath { get; init; } = "node";

    /// <summary>Absolute path to packages/cli/dist/index.js — the real, compiled `forge` CLI (docs/adr/0009/0010). No default — this is real deployment/test configuration, not something safe to guess at.</summary>
    public required string CliEntryPath { get; init; }

    /// <summary>
    /// Generous relative to <c>SmokeGateOptions</c>'s 60s: a real `vite
    /// build` plus asset inlining (packages/player/scripts/build-app.mjs)
    /// measured around 7-8s locally in this session's own runs, but a
    /// cold Consumption-plan instance or a heavier project could run
    /// meaningfully slower — this bounds a genuinely hung/broken
    /// subprocess, not normal variance.
    /// </summary>
    public int TimeoutSeconds { get; init; } = 180;
}
