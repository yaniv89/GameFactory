using System.Text.Json;
using Forge.Domain.Entities;
using Forge.Domain.Versioning;

namespace Forge.Api.Features.Registry.Publishing;

/// <summary>
/// docs/SPEC.md Section 10.4 gate 1: schema shape, semver validity, and
/// coherence between the manifest a publisher uploads and the request
/// fields it's published under — a mismatched or malformed manifest never
/// reaches gates 2/3. Deliberately a hand-checked subset of Section 9.2's
/// (module) and Section 11.2's (Art Pack) full manifest shape, not an
/// exhaustive JSON Schema translation: the fields checked here are the
/// ones this registry itself relies on (identity, versioning, declared
/// capabilities) — optional descriptive/UX fields (readme, editor panel
/// names, config schema shape) are the concern of the editor that renders
/// them, not this gate.
/// </summary>
public static class ManifestValidator
{
    /// <summary>docs/SPEC.md Section 10.3's capability table — the complete, closed set a Module manifest may declare.</summary>
    public static readonly IReadOnlySet<string> KnownCapabilities = new HashSet<string>(
        ["render", "audio", "storage:local", "storage:global", "network", "input:raw", "clipboard", "player-identity"]);

    // Dictionary<...>, not IReadOnlyDictionary<...>: TypedResults.ValidationProblem
    // (PublishVersionEndpoint's only caller) requires IDictionary<string, string[]>,
    // which the read-only interface doesn't satisfy.
    public static Dictionary<string, string[]> Validate(JsonElement manifest, string expectedName, string expectedVersion, string expectedKind)
    {
        var errors = new Dictionary<string, List<string>>();
        void AddError(string field, string message)
        {
            if (!errors.TryGetValue(field, out var list)) errors[field] = list = [];
            list.Add(message);
        }

        if (manifest.ValueKind != JsonValueKind.Object)
        {
            AddError("manifest", "Must be a JSON object.");
            return ToArrayDictionary(errors);
        }

        var name = GetString(manifest, "name");
        if (name is null) AddError("manifest.name", "Required.");
        else if (name != expectedName) AddError("manifest.name", $"Manifest declares '{name}', which does not match the package being published ('{expectedName}').");

        var version = GetString(manifest, "version");
        if (version is null) AddError("manifest.version", "Required.");
        else if (version != expectedVersion) AddError("manifest.version", $"Manifest declares '{version}', which does not match the version being published ('{expectedVersion}').");
        else if (!SemVer.TryParse(version, out _)) AddError("manifest.version", $"'{version}' is not a valid semantic version.");

        var kind = GetString(manifest, "kind");
        if (kind is null) AddError("manifest.kind", "Required.");
        else if (!PackageKind.All.Contains(kind)) AddError("manifest.kind", $"Must be one of: {string.Join(", ", PackageKind.All)}.");
        else if (kind != expectedKind) AddError("manifest.kind", $"Manifest declares '{kind}', which does not match the request's kind ('{expectedKind}').");

        var engine = GetString(manifest, "engine");
        if (engine is null) AddError("manifest.engine", "Required.");
        else if (!SemVerRange.TryParse(engine, out _)) AddError("manifest.engine", $"'{engine}' is not a valid version range.");

        if (GetString(manifest, "displayName") is null) AddError("manifest.displayName", "Required.");
        if (GetString(manifest, "summary") is null) AddError("manifest.summary", "Required.");
        if (GetString(manifest, "license") is null) AddError("manifest.license", "Required.");

        if (kind == PackageKind.Module)
        {
            ValidateModuleCapabilities(manifest, AddError);
        }
        else if (kind == PackageKind.ArtPack)
        {
            ValidateArtPackShape(manifest, AddError);
        }

        return ToArrayDictionary(errors);
    }

    private static void ValidateModuleCapabilities(JsonElement manifest, Action<string, string> addError)
    {
        if (!manifest.TryGetProperty("capabilities", out var capabilities)) return; // Optional — a module can declare none.

        if (capabilities.ValueKind != JsonValueKind.Array)
        {
            addError("manifest.capabilities", "Must be an array.");
            return;
        }

        var declared = new List<string>();
        foreach (var entry in capabilities.EnumerateArray())
        {
            var value = entry.ValueKind == JsonValueKind.String ? entry.GetString() : null;
            if (value is null || !KnownCapabilities.Contains(value))
            {
                addError("manifest.capabilities", $"'{(value ?? entry.ToString())}' is not a recognized capability. Known capabilities: {string.Join(", ", KnownCapabilities)}.");
                continue;
            }
            declared.Add(value);
        }

        // docs/SPEC.md Section 10.3's own warning: network is the
        // dangerous capability specifically because it can reach anywhere
        // by default — a declared allowlist is what the "explicit prompt,
        // domains shown" consent step (and the CSP connect-src it feeds)
        // actually has something to show.
        if (declared.Contains("network"))
        {
            var hasAllowlist = manifest.TryGetProperty("networkAllowlist", out var allowlist)
                && allowlist.ValueKind == JsonValueKind.Array
                && allowlist.GetArrayLength() > 0
                && allowlist.EnumerateArray().All(e => e.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(e.GetString()));
            if (!hasAllowlist)
            {
                addError("manifest.networkAllowlist", "Required and must be a non-empty array of domain strings when the 'network' capability is declared.");
            }
        }
    }

    private static void ValidateArtPackShape(JsonElement manifest, Action<string, string> addError)
    {
        if (!manifest.TryGetProperty("grid", out var grid) || grid.ValueKind != JsonValueKind.Object
            || !grid.TryGetProperty("tileSize", out var tileSize) || tileSize.ValueKind != JsonValueKind.Number || tileSize.GetInt32() <= 0)
        {
            addError("manifest.grid.tileSize", "Required and must be a positive integer.");
        }

        if (!manifest.TryGetProperty("implements", out var implementsEl) || implementsEl.ValueKind != JsonValueKind.Array || implementsEl.GetArrayLength() == 0)
        {
            addError("manifest.implements", "Required and must be a non-empty array of capability profile names (docs/SPEC.md Section 11.3).");
        }
    }

    private static string? GetString(JsonElement element, string propertyName) =>
        element.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static Dictionary<string, string[]> ToArrayDictionary(Dictionary<string, List<string>> errors) =>
        errors.ToDictionary(kv => kv.Key, kv => kv.Value.ToArray());
}
