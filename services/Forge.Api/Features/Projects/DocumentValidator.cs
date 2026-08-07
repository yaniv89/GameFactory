using System.Text.Json;

namespace Forge.Api.Features.Projects;

public sealed class DocumentValidator : IDocumentValidator
{
    /// <summary>
    /// Generous enough for any real scene graph (docs/SPEC.md Section
    /// 7.4's example is a handful of levels deep) while still bounding
    /// recursion in anything that later walks the tree.
    /// </summary>
    private const int MaxNestingDepth = 64;

    public Task<DocumentValidationResult> ValidateAsync(JsonElement document, CancellationToken ct)
    {
        if (document.ValueKind != JsonValueKind.Object)
        {
            return Task.FromResult(DocumentValidationResult.Invalid("document", "Must be a JSON object."));
        }

        if (!document.TryGetProperty("scenes", out var scenes) || scenes.ValueKind != JsonValueKind.Array)
        {
            return Task.FromResult(DocumentValidationResult.Invalid("document.scenes", "Missing, or not an array."));
        }

        if (GetDepth(document) > MaxNestingDepth)
        {
            return Task.FromResult(DocumentValidationResult.Invalid("document", $"Exceeds the maximum nesting depth of {MaxNestingDepth}."));
        }

        return Task.FromResult(DocumentValidationResult.Valid);
    }

    private static int GetDepth(JsonElement element) => element.ValueKind switch
    {
        JsonValueKind.Object => element.EnumerateObject().Select(p => GetDepth(p.Value)).DefaultIfEmpty(0).Max() + 1,
        JsonValueKind.Array => element.EnumerateArray().Select(GetDepth).DefaultIfEmpty(0).Max() + 1,
        _ => 0,
    };
}
