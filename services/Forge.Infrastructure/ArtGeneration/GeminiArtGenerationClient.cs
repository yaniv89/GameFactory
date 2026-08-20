using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Forge.Infrastructure.ArtGeneration;

/// <summary>
/// Real implementation of <see cref="IArtGenerationClient"/>, calling the
/// Gemini Generative Language REST API (`generativelanguage.googleapis.com`)
/// directly via <see cref="HttpClient"/> rather than an official Google
/// SDK package — docs/adr/0016's own "new dependency outside CLAUDE.md
/// Section 2 gets the same explicit ask ImageSharp got" consequence is
/// avoided entirely for this piece: the REST surface used here (one
/// `generateContent` call, JSON in, JSON/base64 out) is simple enough
/// that a hand-written client is less total surface than a general-purpose
/// SDK, and it means this dependency is exactly what CLAUDE.md Section 2
/// already allows without asking — an HTTP call, not a package.
///
/// <b>Flagged, not guessed:</b> the specific model IDs
/// (<c>ArtGeneration:TextModel</c>/<c>ArtGeneration:ImageModel</c>) are
/// configuration-driven rather than hardcoded, and deliberately left
/// unset here rather than defaulted to a specific dated model string —
/// Google's available model IDs change over time, and this codebase
/// should not present a guessed model name as a verified fact (CLAUDE.md's
/// "say 'I don't know' and propose a way to verify" — the way to verify
/// is checking Google's current model list at deploy time, not trusting
/// whatever this comment might have said when it was written).
/// </summary>
public sealed class GeminiArtGenerationOptions
{
    public required string ApiKey { get; init; }

    public required string TextModel { get; init; }

    public required string ImageModel { get; init; }
}

public sealed class GeminiArtGenerationClient(HttpClient httpClient, GeminiArtGenerationOptions options) : IArtGenerationClient
{
    private const string BaseUrl = "https://generativelanguage.googleapis.com/v1beta/models";

    // docs/adr/0016 Decision 5: fixed per category, never influenced by
    // the creator's own text — this is what makes the system-
    // instruction/user-content separation real rather than nominal.
    private static readonly IReadOnlyDictionary<string, string> CategoryInstructions = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        [Domain.Entities.ArtGenCategory.Tile] =
            "You write image-generation prompts for a top-down 2D pixel-art RPG's terrain tiles. " +
            "Given a short description of a terrain type, write a detailed prompt for a single, seamlessly " +
            "tileable, top-down texture swatch in a cohesive pixel-art style, no characters or props in frame, " +
            "no text or watermarks, no drop shadow implying a light direction that would break tiling.",
        [Domain.Entities.ArtGenCategory.Prop] =
            "You write image-generation prompts for a top-down 2D pixel-art RPG's scenery props. " +
            "Given a short description of an object, write a detailed prompt for a single subject, isometric or " +
            "top-down perspective matching a cohesive pixel-art style, centered, on a solid #FF00FF magenta " +
            "background (for chroma-key extraction), no text or watermarks, no ground shadow gradient extending " +
            "past the subject's own base.",
    };

    public async Task<ExpandPromptResult> ExpandPromptAsync(ExpandPromptRequest request, CancellationToken ct)
    {
        if (!CategoryInstructions.TryGetValue(request.Category, out var systemInstruction))
        {
            throw new ArgumentOutOfRangeException(nameof(request), request.Category, "Unknown ArtGenCategory.");
        }
        if (request.ActivePackStyleHint is { Length: > 0 } hint)
        {
            systemInstruction += $" Match this pack's existing art style: {hint}.";
        }

        var body = new GenerateContentRequestBody(
            SystemInstruction: new GeminiContent("system", [new GeminiPart(Text: systemInstruction)]),
            Contents: [new GeminiContent("user", [new GeminiPart(Text: request.UserPrompt)])]);

        using var response = await httpClient.PostAsJsonAsync(
            $"{BaseUrl}/{options.TextModel}:generateContent?key={Uri.EscapeDataString(options.ApiKey)}",
            body,
            JsonOptions,
            ct);

        // A safety-filtered refusal comes back as a normal 200 with
        // `promptFeedback.blockReason` set and no candidates — not an
        // HTTP error. Check that before EnsureSuccessStatusCode() so a
        // real decline never gets miscategorized as a Failed harness
        // error (docs/adr/0016 Decision 6's Declined/Failed distinction).
        if (response.IsSuccessStatusCode)
        {
            var parsed = await response.Content.ReadFromJsonAsync<GenerateContentResponseBody>(JsonOptions, ct);
            if (parsed?.PromptFeedback?.BlockReason is { Length: > 0 } blockReason)
            {
                return new ExpandPromptResult(Declined: true, ExpandedPrompt: null, DeclineReason: blockReason);
            }
            var text = parsed?.Candidates?.FirstOrDefault()?.Content?.Parts?.FirstOrDefault()?.Text;
            if (string.IsNullOrWhiteSpace(text))
            {
                return new ExpandPromptResult(Declined: true, ExpandedPrompt: null, DeclineReason: "No content returned.");
            }
            return new ExpandPromptResult(Declined: false, ExpandedPrompt: text, DeclineReason: null);
        }

        response.EnsureSuccessStatusCode(); // Throws with the real status/body for a genuine transient/harness failure -> caller maps to Failed, never Declined.
        throw new InvalidOperationException("Unreachable."); // EnsureSuccessStatusCode always throws on a non-success response above.
    }

    public async Task<GenerateImageResult> GenerateImageAsync(GenerateImageRequest request, CancellationToken ct)
    {
        var body = new GenerateContentRequestBody(
            SystemInstruction: null,
            Contents: [new GeminiContent("user", [new GeminiPart(request.ExpandedPrompt)])],
            CandidateCount: request.VariationCount);

        using var response = await httpClient.PostAsJsonAsync(
            $"{BaseUrl}/{options.ImageModel}:generateContent?key={Uri.EscapeDataString(options.ApiKey)}",
            body,
            JsonOptions,
            ct);

        if (response.IsSuccessStatusCode)
        {
            var parsed = await response.Content.ReadFromJsonAsync<GenerateContentResponseBody>(JsonOptions, ct);
            if (parsed?.PromptFeedback?.BlockReason is { Length: > 0 } blockReason)
            {
                return new GenerateImageResult(Declined: true, Images: [], DeclineReason: blockReason);
            }

            var images = new List<GeneratedImage>();
            foreach (var candidate in parsed?.Candidates ?? [])
            {
                foreach (var part in candidate.Content?.Parts ?? [])
                {
                    if (part.InlineData is { Data: { Length: > 0 } data, MimeType: { Length: > 0 } mimeType })
                    {
                        images.Add(new GeneratedImage(Convert.FromBase64String(data), mimeType));
                    }
                }
            }
            if (images.Count == 0)
            {
                return new GenerateImageResult(Declined: true, Images: [], DeclineReason: "No image content returned.");
            }
            return new GenerateImageResult(Declined: false, Images: images, DeclineReason: null);
        }

        response.EnsureSuccessStatusCode();
        throw new InvalidOperationException("Unreachable.");
    }

    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private sealed record GenerateContentRequestBody(
        [property: JsonPropertyName("system_instruction")] GeminiContent? SystemInstruction,
        [property: JsonPropertyName("contents")] GeminiContent[] Contents,
        [property: JsonPropertyName("candidateCount")] int? CandidateCount = null);

    private sealed record GeminiContent([property: JsonPropertyName("role")] string Role, [property: JsonPropertyName("parts")] GeminiPart[] Parts);

    private sealed record GeminiPart(
        [property: JsonPropertyName("text")] string? Text = null,
        [property: JsonPropertyName("inlineData")] GeminiInlineData? InlineData = null);

    private sealed record GeminiInlineData([property: JsonPropertyName("mimeType")] string? MimeType, [property: JsonPropertyName("data")] string? Data);

    private sealed record GenerateContentResponseBody(
        [property: JsonPropertyName("candidates")] GeminiCandidate[]? Candidates,
        [property: JsonPropertyName("promptFeedback")] GeminiPromptFeedback? PromptFeedback);

    private sealed record GeminiCandidate([property: JsonPropertyName("content")] GeminiContent? Content);

    private sealed record GeminiPromptFeedback([property: JsonPropertyName("blockReason")] string? BlockReason);
}
