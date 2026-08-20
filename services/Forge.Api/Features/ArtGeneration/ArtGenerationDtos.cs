namespace Forge.Api.Features.ArtGeneration;

public sealed record CreateGenerationRequestRequest(string UserPrompt, string Category);

/// <summary>
/// <see cref="ExpandedPrompt"/> is set only when <see cref="Status"/> is
/// <c>awaiting_confirmation</c>; <see cref="ErrorMessage"/> only on
/// <c>failed</c>/<c>declined</c> (docs/adr/0016 Decision 6's own
/// distinction between the two).
/// </summary>
public sealed record GenerationRequestResponse(
    Guid Id,
    string Category,
    string Status,
    string? ExpandedPrompt,
    string? ErrorMessage,
    DateTimeOffset CreatedAt);
