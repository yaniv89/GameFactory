namespace Forge.Api.Features.ArtGeneration;

public sealed record CreateGenerationRequestRequest(string UserPrompt, string Category);

/// <summary>One <see cref="Domain.Entities.GenerationVariation"/>, as seen by an authenticated workspace member — never the blob path itself (N5: content is fetched through <see cref="GetGenerationVariationContentEndpoint"/>, keyed by <see cref="Id"/>, same as <c>Forge.Api.Features.Assets.GetAssetContentEndpoint</c> never exposing a raw storage path either).</summary>
public sealed record GenerationVariationResponse(Guid Id, int Width, int Height, bool Selected);

/// <summary>
/// <see cref="ExpandedPrompt"/> is set only when <see cref="Status"/> is
/// <c>awaiting_confirmation</c>; <see cref="ErrorMessage"/> only on
/// <c>failed</c>/<c>declined</c> (docs/adr/0016 Decision 6's own
/// distinction between the two). <see cref="Variations"/> is only ever
/// non-empty once <see cref="Status"/> reaches <c>ready</c> — Create and
/// Confirm's own responses always return it empty, since neither call can
/// have produced a variation yet; <see cref="GetGenerationRequestEndpoint"/>
/// (N5) is the only caller that can observe a populated one.
/// </summary>
public sealed record GenerationRequestResponse(
    Guid Id,
    string Category,
    string Status,
    string? ExpandedPrompt,
    string? ErrorMessage,
    DateTimeOffset CreatedAt,
    IReadOnlyList<GenerationVariationResponse> Variations);

/// <summary>N5: the creator-chosen resolution path for the promoted <see cref="Domain.Entities.Asset"/> a selection becomes — the same free-form, project-relative naming <c>UploadAssetRequest.OriginalName</c> already accepts, not a generated name, so the creator controls what shows up in Art Pack resolution and the Assets library.</summary>
public sealed record SelectGenerationVariationRequest(string AssetName);

public sealed record SelectGenerationVariationResponse(Guid AssetId, string OriginalName);
