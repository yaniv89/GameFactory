namespace Forge.Infrastructure.ArtGeneration;

public sealed record ExpandPromptRequest(string UserPrompt, string Category, string? ActivePackStyleHint);

/// <summary>
/// <see cref="Declined"/> distinguishes "the call completed and Gemini's
/// own safety filtering refused it" from a thrown exception (a transient
/// failure, a bad API key, a network error) — the endpoint maps the
/// former to <see cref="Domain.Entities.GenerationStatus.Declined"/> and
/// the latter to <see cref="Domain.Entities.GenerationStatus.Failed"/>,
/// docs/adr/0016 Decision 6's own distinction.
/// </summary>
public sealed record ExpandPromptResult(bool Declined, string? ExpandedPrompt, string? DeclineReason);

public sealed record GenerateImageRequest(string ExpandedPrompt, string Category, int VariationCount);

public sealed record GeneratedImage(byte[] Bytes, string MimeType);

public sealed record GenerateImageResult(bool Declined, IReadOnlyList<GeneratedImage> Images, string? DeclineReason);

/// <summary>
/// The two Gemini operations docs/adr/0016 Decision 2's pipeline needs,
/// behind an interface so the endpoints' own logic (authorization,
/// validation, plan/rate-limit/budget gating, status transitions) is
/// testable without a real Gemini API key — which this environment
/// doesn't have. Same reasoning and same shape as
/// <see cref="Billing.IStripeBillingClient"/>'s own doc comment.
/// <see cref="GeminiArtGenerationClient"/> is the real implementation;
/// Forge.Tests has a hand-written fake, not a mocking framework, matching
/// this codebase's existing convention for the one dependency (an
/// external paid API) that can't be a real Testcontainer.
/// </summary>
public interface IArtGenerationClient
{
    /// <summary>docs/adr/0016 Decision 5: <paramref name="request"/>'s <see cref="ExpandPromptRequest.UserPrompt"/> is passed as user content within a call whose system instruction is Forge's own fixed generation-convention template — never string-concatenated with it.</summary>
    Task<ExpandPromptResult> ExpandPromptAsync(ExpandPromptRequest request, CancellationToken ct);

    /// <summary>docs/adr/0016 Decision 2: called only from <c>Forge.Functions.ArtGen</c> (N3), never synchronously from <c>Forge.Api</c> — real generation latency is unbounded in a way a request thread shouldn't block on.</summary>
    Task<GenerateImageResult> GenerateImageAsync(GenerateImageRequest request, CancellationToken ct);
}
