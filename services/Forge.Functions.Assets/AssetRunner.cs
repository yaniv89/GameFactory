using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Png;

namespace Forge.Functions.Assets;

/// <summary>What this worker needs to process one claimed asset — just the original bytes. The entity's own metadata (declared MIME type, original name) informed <c>UploadAssetEndpoint</c>'s allowlist check but plays no role here: docs/adr/0012 Decision 3's whole point is that check was never a claim about what these bytes actually decode to.</summary>
public sealed record AssetRunRequest(byte[] OriginalBytes);

/// <summary>The real, re-encoded output of a successful process — bytes ImageSharp itself produced from decoded pixel data (docs/adr/0012 Decision 4), plus the real dimensions it decoded. Never the client-declared or guessed dimensions, never the uploaded bytes themselves.</summary>
public sealed record ProcessedAssetArtifact(byte[] PngBytes, int Width, int Height);

/// <summary>
/// Thrown when this worker's own environment is the problem, not the
/// asset — reserved for the same requeue-vs-fail split
/// <c>Forge.Functions.Build.BuildHarnessException</c> establishes.
/// <see cref="AssetRunner"/> itself never throws this (there's no
/// external process to fail to start the way a CLI subprocess can); it
/// exists so <see cref="AssetOrchestrator"/> can treat a storage-layer
/// failure (the quarantined original went missing) the same way.
/// </summary>
public sealed class AssetHarnessException(string message, Exception? innerException = null) : Exception(message, innerException);

/// <summary>Thrown when the uploaded bytes themselves are the problem — not a valid PNG/JPEG/WebP image, or one whose declared dimensions exceed the cap. A real, attributable verdict: <see cref="Exception.Message"/> is already creator-facing copy (CLAUDE.md Section 5.5's copy rules — what happened, why, what to do next), safe to store verbatim as <see cref="Domain.Entities.Asset.ErrorMessage"/>.</summary>
public sealed class AssetProcessingFailedException(string message) : Exception(message);

/// <summary>
/// docs/adr/0012 Decision 4 — the only place in the whole system that
/// ever turns untrusted bytes into decoded pixels. <c>Forge.Api</c>
/// (<c>UploadAssetEndpoint</c>) deliberately never does this (Decision
/// 3's own point). Runs entirely in-process: unlike <c>BuildRunner</c>,
/// there is no external subprocess to isolate, because ImageSharp's own
/// memory safety (Decision 4's load-bearing argument — fully managed, no
/// native code anywhere in the decode path) *is* the isolation here. The
/// process boundary that still matters is the one
/// <c>Forge.Functions.Assets</c> itself already is: a distinct process
/// from <c>Forge.Api</c>, zero network egress, a fresh container per
/// invocation.
/// </summary>
public sealed class AssetRunner
{
    // docs/adr/0012 Decision 4 step 3: matches SPEC 14.3's own atlas-size
    // cap reasoning (4096 is unsafe on older mobile GPUs). Checked against
    // Image.Identify's declared header dimensions, BEFORE Image.Load —
    // confirmed by actually running it, not assumed: a hand-crafted
    // 57-byte PNG with a 50000x50000 IHDR (a full decode of which would
    // try to allocate ~10GB of RGBA pixel data) was correctly identified
    // in under 100ms with a memory delta under 100KB, never touching
    // pixel data. That's the real decompression-bomb defense — rejecting
    // before the expensive allocation exists, not catching it after.
    private const int MaxDimension = 4096;

    public ProcessedAssetArtifact Run(AssetRunRequest request)
    {
        IImageInfo? info;
        try
        {
            info = Image.Identify(request.OriginalBytes);
        }
        catch (Exception)
        {
            // Image.Identify's own documented, verified behavior is to
            // return null for unrecognized/malformed content (confirmed
            // against garbage bytes and empty input) rather than throw —
            // this catch is defense in depth against a format-specific
            // decoder throwing something else instead, not the expected
            // path.
            throw new AssetProcessingFailedException("This file isn't a valid PNG, JPEG, or WebP image.");
        }

        if (info is null)
        {
            throw new AssetProcessingFailedException("This file isn't a valid PNG, JPEG, or WebP image.");
        }
        if (info.Width > MaxDimension || info.Height > MaxDimension)
        {
            throw new AssetProcessingFailedException(
                $"Image dimensions ({info.Width}x{info.Height}) exceed the {MaxDimension}x{MaxDimension} limit.");
        }

        using var image = LoadOrFail(request.OriginalBytes);
        using var output = new MemoryStream();
        // The re-encoded bytes here are new bytes ImageSharp itself
        // produced from decoded pixel data — never the uploaded bytes
        // copied or passed through (docs/adr/0012 Decision 4/6). Whatever
        // the original byte stream actually was (a polyglot file, a PNG
        // with trailing non-image data appended), what leaves this method
        // is provably nothing but the pixels ImageSharp decoded,
        // re-serialized as a clean PNG.
        image.Save(output, new PngEncoder());
        return new ProcessedAssetArtifact(output.ToArray(), image.Width, image.Height);
    }

    private static Image LoadOrFail(byte[] originalBytes)
    {
        try
        {
            return Image.Load(originalBytes);
        }
        catch (UnknownImageFormatException)
        {
            // Reachable if a file's header alone looked like a real image
            // to Identify (which reads less of the file) but the body
            // doesn't actually decode — still a real, attributable
            // verdict about this specific file, not a harness problem.
            throw new AssetProcessingFailedException("This file isn't a valid PNG, JPEG, or WebP image.");
        }
    }
}
