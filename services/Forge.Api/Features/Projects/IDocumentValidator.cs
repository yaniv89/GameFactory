using System.Text.Json;

namespace Forge.Api.Features.Projects;

public sealed record DocumentValidationResult(bool IsValid, IDictionary<string, string[]> Errors)
{
    public static DocumentValidationResult Valid { get; } = new(true, new Dictionary<string, string[]>());

    public static DocumentValidationResult Invalid(string field, string message) =>
        new(false, new Dictionary<string, string[]> { [field] = [message] });
}

/// <summary>
/// Structural validation for a committed project document (docs/SPEC.md
/// Section 7, CLAUDE.md Section 4.6 — project documents are a named input
/// source). Deliberately not a full JSON-Schema validator against Section
/// 7's complete on-disk format: that format describes multi-file exports
/// with per-Module config schemas resolved against a workspace's actually
/// installed Modules, which doesn't exist as a single-document concept
/// yet, and the editor's own current document model (M4,
/// packages/editor/src/store/projectStore.ts) is a much smaller prototype
/// shape (<c>{ scenes, installedModules }</c>) than Section 7 describes.
/// Validating against the full spec here would reject the one real client
/// that exists. What this checks is real and load-bearing regardless of
/// how the document format grows: it must be a JSON object, not some
/// other JSON type a client could still legally POST, and it must not
/// nest deep enough to be a problem for recursive processing later (the
/// build pipeline, export, diffing) — an actual, if narrow, threat this
/// endpoint is the first line of defense against.
/// </summary>
public interface IDocumentValidator
{
    Task<DocumentValidationResult> ValidateAsync(JsonElement document, CancellationToken ct);
}
