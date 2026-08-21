namespace Forge.Infrastructure.Storage;

/// <summary>
/// docs/adr/0016 Decision 3/6: one container for
/// <see cref="Domain.Entities.GenerationVariation"/> content — no
/// separate quarantine container the way <see cref="IAssetStorage"/> has
/// one. That two-container split exists so an uploaded creator file can
/// sit untouched, undecoded, before <c>Forge.Functions.Assets</c> ever
/// reads it; here, the untrusted bytes never touch a blob at all until
/// <em>after</em> <c>Forge.Functions.ArtGen</c> (N3) has already run them
/// through the identical decode/re-encode pass (reusing
/// <c>Forge.Functions.Assets.AssetRunner</c> directly, per docs/adr/0016
/// Decision 3) on the in-memory bytes Gemini's response itself carried —
/// there is no separate "upload, then process" step to isolate a
/// quarantine window around. What gets uploaded here is always already
/// re-encoded, decode-verified pixel data, same as
/// <see cref="IAssetStorage.UploadProcessedAsync"/>'s own contract.
/// Container access is private, same as every other container this
/// codebase manages — content is served through an authenticated
/// <c>Forge.Api</c> endpoint (N5), never a directly public blob URL.
/// </summary>
public interface IArtGenerationStorage
{
    Task UploadVariationAsync(Guid workspaceId, Guid generationRequestId, Guid variationId, byte[] pngBytes, CancellationToken ct);

    Task<byte[]> DownloadVariationAsync(Guid workspaceId, Guid generationRequestId, Guid variationId, CancellationToken ct);
}

/// <summary>Thrown by <see cref="IArtGenerationStorage.DownloadVariationAsync"/> when the target variation has no content — genuinely inconsistent state for a row the database says exists, surfaced as a 404 by the caller rather than a 500 (same pattern as <see cref="AssetProcessedNotFoundException"/>).</summary>
public sealed class ArtGenerationVariationNotFoundException(Guid variationId)
    : Exception($"No content found for generation variation '{variationId}'.");
