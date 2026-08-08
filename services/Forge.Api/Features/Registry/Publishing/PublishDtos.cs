using System.Text.Json;

namespace Forge.Api.Features.Registry.Publishing;

public sealed record PublishVersionRequest(
    string Kind,
    string DisplayName,
    string Summary,
    string? ReadmeMarkdown,
    string? HomepageUrl,
    string LicenseSpdx,
    string Version,
    string EngineRange,
    JsonElement Manifest,
    string BundleBase64,
    Dictionary<string, string>? Dependencies);

public sealed record PublishVersionResponse(
    Guid PackageId,
    Guid VersionId,
    string ScanStatus,
    IReadOnlyList<string> StaticAnalysisFindings);
