using Forge.Domain.Entities;
using Forge.Functions.Assets;
using Forge.Infrastructure.ArtGeneration;
using Forge.Infrastructure.Storage;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Png;
using SixLabors.ImageSharp.PixelFormats;

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
/// Category-specific finishing (docs/adr/0016 Decision 1/4, N4): a Tile
/// variation is genuinely usable as-is once decode-verified (docs/adr/0014's
/// own "no transparency needed — the whole frame is the asset" for
/// terrain tiles), so it's stored unmodified. A Prop variation runs
/// through <see cref="ChromaKeyExtractor"/> (the C#/ImageSharp port of
/// this session's own <c>chroma_key_extract.py</c>) on top of the
/// already-decode-verified pixels — magenta background out, real alpha
/// in, spill-suppressed, cropped tight — matching the same generation
/// convention the Gemini prompt template (<c>GeminiArtGenerationClient</c>'s
/// own <c>CategoryInstructions</c>) asks for a Prop image to use in the
/// first place.
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

            byte[] finalPngBytes;
            int finalWidth, finalHeight;
            if (claimed.Category == ArtGenCategory.Prop)
            {
                try
                {
                    (finalPngBytes, finalWidth, finalHeight) = FinishProp(artifact.PngBytes);
                }
                catch (Exception ex) when (ex is NoKeyColorFoundException or InvalidOperationException)
                {
                    // A real, attributable failure of *this specific*
                    // generated image -- Gemini's own output didn't
                    // actually carry a keyable magenta background (or
                    // keyed out to nothing), despite the prompt asking
                    // for one. Same "skip this one, keep the batch going"
                    // treatment as a decode-safety failure above, not a
                    // harness problem.
                    lastDecodeFailureReason = ex.Message;
                    continue;
                }
            }
            else
            {
                finalPngBytes = artifact.PngBytes;
                finalWidth = artifact.Width;
                finalHeight = artifact.Height;
            }

            var variationId = Guid.NewGuid();
            try
            {
                await storage.UploadVariationAsync(claimed.WorkspaceId, claimed.Id, variationId, finalPngBytes, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                await scanner.RequeueAsync(claimed.Id, ct);
                throw new ArtGenHarnessException($"Failed to upload a generated variation for request '{claimed.Id}'.", ex);
            }

            completed.Add(new CompletedVariation(variationId, $"{claimed.WorkspaceId}/{claimed.Id}/{variationId}.png", finalWidth, finalHeight));
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

    /// <summary>
    /// docs/adr/0016 Decision 4 (N4): chroma-key + crop-to-content on top
    /// of already decode-verified pixel data (<paramref name="decodedPngBytes"/>
    /// is <see cref="ProcessedAssetArtifact.PngBytes"/>, never the raw
    /// Gemini response bytes). Default <see cref="ChromaKeyOptions"/> —
    /// the same magenta/tolerance/feather/pad defaults
    /// <c>tools/art-pipeline/chroma_key_extract.py</c> uses, matching the
    /// magenta-background convention <c>GeminiArtGenerationClient</c>'s
    /// own Prop system instruction asks the model to follow.
    /// </summary>
    private static (byte[] PngBytes, int Width, int Height) FinishProp(byte[] decodedPngBytes)
    {
        var options = new ChromaKeyOptions();
        using var source = Image.Load<Rgba32>(decodedPngBytes);
        using var keyed = ChromaKeyExtractor.Extract(source, options);
        using var cropped = ChromaKeyExtractor.CropToContent(keyed, options.Pad);
        using var output = new MemoryStream();
        cropped.Save(output, new PngEncoder());
        return (output.ToArray(), cropped.Width, cropped.Height);
    }
}
