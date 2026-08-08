using System.Text.Json.Serialization;

namespace Forge.Functions.Scan.SmokeGate;

/// <summary>
/// Mirrors packages/runtime-host/src/smoke/smokeRunner.ts's
/// <c>SmokeRunOptions</c> exactly — this is the JSON this process writes
/// to the CLI subprocess's stdin. Field names/casing must stay in sync
/// with that file; there is no shared schema between the two languages
/// to enforce it mechanically.
/// </summary>
public sealed record SmokeRunRequest
{
    [JsonPropertyName("moduleName")]
    public required string ModuleName { get; init; }

    [JsonPropertyName("version")]
    public required string Version { get; init; }

    [JsonPropertyName("engineVersion")]
    public required string EngineVersion { get; init; }

    [JsonPropertyName("bundleSource")]
    public required string BundleSource { get; init; }

    [JsonPropertyName("networkAllowedOrigins")]
    public IReadOnlyList<string>? NetworkAllowedOrigins { get; init; }

    [JsonPropertyName("ticks")]
    public int? Ticks { get; init; }

    [JsonPropertyName("computeBudgetMs")]
    public int? ComputeBudgetMs { get; init; }
}

/// <summary>Mirrors packages/runtime-host/src/smoke/smokeRunner.ts's <c>SmokeRunReport</c>.</summary>
public sealed record SmokeRunReport
{
    [JsonPropertyName("verdict")]
    public required string Verdict { get; init; }

    [JsonPropertyName("ticksRequested")]
    public int TicksRequested { get; init; }

    [JsonPropertyName("ticksCompleted")]
    public int TicksCompleted { get; init; }

    [JsonPropertyName("crashed")]
    public bool Crashed { get; init; }

    [JsonPropertyName("error")]
    public SmokeRunError? Error { get; init; }

    [JsonPropertyName("budget")]
    public required SmokeRunBudget Budget { get; init; }
}

public sealed record SmokeRunError
{
    [JsonPropertyName("phase")]
    public required string Phase { get; init; }

    [JsonPropertyName("name")]
    public required string Name { get; init; }

    [JsonPropertyName("message")]
    public required string Message { get; init; }
}

public sealed record SmokeRunBudget
{
    [JsonPropertyName("maxTickMs")]
    public double MaxTickMs { get; init; }

    [JsonPropertyName("totalMs")]
    public double TotalMs { get; init; }

    [JsonPropertyName("averageTickMs")]
    public double AverageTickMs { get; init; }
}
