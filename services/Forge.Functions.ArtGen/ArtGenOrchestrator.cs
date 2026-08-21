using Forge.Domain.Entities;
using Forge.Functions.Assets;
using Forge.Infrastructure.ArtGeneration;
using Forge.Infrastructure.Storage;

namespace Forge.Functions.ArtGen;

/// <summary>Thrown when this worker's own environment is the problem, not the request — the same requeue-vs-fail split <c>AssetHarnessException</c> establishes (a transient Gemini/network failure calling <see cref="IArtGenerationClient.GenerateImageAsync"/>, or a storage-layer failure uploading a variation).</summary>
public sealed class ArtGenHarnessException(string message, Exception? innerException = null) : Exception(message, innerException);

/// <summary>
/// Wires <see cref="ArtGenScanner"/> (claim/complete against
/// <c>generation_requests</c>), <see cref="IArtGenerationClient"/> (the
/// real Gemini image-generation call, docs/adr/0016 Decision 2), the
/// existing <see cref="AssetRunner"/> (docs/adr/0012 Decision 4's decode/
/// re-encode — reused verbatim per docs/adr/0016 Decision 3, not
/// reimplemented) and <see cref="IArtGenerationStorage"/> into N3's
/// actual per-request workflow — the same shape
/// <c>Forge.Functions.Assets.AssetOrchestrator</c> already established
/// for E3. Variation batching: one <see cref="GenerationRequest"/> can
/// produce several images in one Gemini call; each is decode-safety-
/// verified independently, and the request only fails outright if *none*
/// of them survive that check — a partial batch (some images malformed,
/// most fine) still produces a real, usable Ready result rather than
/// discarding the whole attempt over one bad image.
///
/// What this does NOT do yet, named per docs/adr/0016 Decision 1/4, not
/// hidden: category-specific finishing (chroma-key + crop-to-content for
/// a Prop) is N4's job. A Tile variation is already genuinely usable as-is
/// once decode-verified (docs/adr/0014's own "no transparency needed —
/// the whole frame is the asset" for terrain tiles); a Prop variation
/// stored by this class is the raw decoded image on its magenta
/// background, not yet chroma-keyed — real, decode-safe pixel data, just
/// not pack-ready until N4 runs.
/// </summary>
public sealed class ArtGenOrchestrator(ArtGenScanner scanner, IArtGenerationClient client, AssetRunner runner, IArtGenerationStorage storage)
{
    // docs/adr/0016: matches the daily-budget ceiling's own spirit --
    // enough variations for a creator to actually pick from, not an
    // unbounded batch that turns one confirm into an unpredictable
    // multiple of the per-call cost this whole pipeline is gated on.
    private const int VariationCount = 4;

    /// <summary>Claims and processes one queued generation request, if any is available. Returns false when there was nothing to claim — the caller (a timer trigger) treats that as "nothing to do this tick," not an error.</summary>
    public async Task<bool> ProcessNextAsync(CancellationToken ct)
    {
        var claimed = await scanner.ClaimNextAsync(ct);
        if (claimed is null) return false;

        GenerateImageResult generated;
        try
        {
            generated = await client.GenerateImageAsync(new GenerateImageRequest(claimed.ExpandedPrompt, claimed.Category, VariationCount), ct);
        }
        catch (HttpRequestException ex)
        {
            await scanner.RequeueAsync(claimed.Id, ct);
            throw new ArtGenHarnessException($"Gemini image generation call failed for request '{claimed.Id}'.", ex);
        }

        if (generated.Declined)
        {
            await scanner.MarkDeclinedAsync(claimed.Id, generated.DeclineReason ?? "The image generation request was declined.", ct);
            return true;
        }

        var completed = new List<CompletedVariation>();
        string? lastDecodeFailureReason = null;
        foreach (var image in generated.Images)
        {
            ProcessedAssetArtifact artifact;
            try
            {
                artifact = runner.Run(new AssetRunRequest(image.Bytes));
            }
            catch (AssetProcessingFailedException ex)
            {
                // One bad variation in the batch, not a verdict on the
                // whole request -- keep going with whatever else came
                // back (this class's own doc comment on variation
                // batching).
                lastDecodeFailureReason = ex.Message;
                continue;
            }

            var variationId = Guid.NewGuid();
            try
            {
                await storage.UploadVariationAsync(claimed.WorkspaceId, claimed.Id, variationId, artifact.PngBytes, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                await scanner.RequeueAsync(claimed.Id, ct);
                throw new ArtGenHarnessException($"Failed to upload a generated variation for request '{claimed.Id}'.", ex);
            }

            completed.Add(new CompletedVariation($"{claimed.WorkspaceId}/{claimed.Id}/{variationId}.png", artifact.Width, artifact.Height));
        }

        if (completed.Count == 0)
        {
            // Every returned image failed decode-safety -- a real,
            // attributable outcome (the provider returned nothing usable
            // this time), not a harness problem.
            await scanner.MarkFailedAsync(
                claimed.Id,
                lastDecodeFailureReason is null
                    ? "The image generation service returned no usable images."
                    : $"None of the generated images were usable: {lastDecodeFailureReason}",
                ct);
            return true;
        }

        await scanner.MarkReadyAsync(claimed.Id, completed, ct);
        return true;
    }
}
