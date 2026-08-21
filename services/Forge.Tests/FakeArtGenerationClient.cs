using Forge.Infrastructure.ArtGeneration;

namespace Forge.Tests;

/// <summary>
/// Test double for <see cref="IArtGenerationClient"/> — this environment
/// has no real Gemini API key, so nothing here calls the real Gemini API.
/// Records what would have been requested so tests can assert on it, and
/// lets a test script the next result (including a Declined outcome or a
/// thrown exception, to exercise the endpoint's own Failed-vs-Declined
/// handling) — same pattern <see cref="FakeStripeBillingClient"/> uses for
/// <see cref="Billing.IStripeBillingClient"/>.
/// </summary>
public sealed class FakeArtGenerationClient : IArtGenerationClient
{
    private readonly List<ExpandPromptRequest> _expandRequests = [];
    private readonly List<GenerateImageRequest> _generateRequests = [];

    public IReadOnlyList<ExpandPromptRequest> ExpandRequests
    {
        get { lock (_expandRequests) return [.. _expandRequests]; }
    }

    public IReadOnlyList<GenerateImageRequest> GenerateRequests
    {
        get { lock (_generateRequests) return [.. _generateRequests]; }
    }

    /// <summary>Set by a test before a call to script the next <see cref="ExpandPromptAsync"/> result. Reset to the default (a plausible success) after each call.</summary>
    public Func<ExpandPromptRequest, ExpandPromptResult>? NextExpandResult { get; set; }

    /// <summary>Set by a test to make the next <see cref="ExpandPromptAsync"/> call throw, simulating a harness failure (network error, provider outage).</summary>
    public bool ThrowOnNextExpand { get; set; }

    public Task<ExpandPromptResult> ExpandPromptAsync(ExpandPromptRequest request, CancellationToken ct)
    {
        lock (_expandRequests) _expandRequests.Add(request);

        if (ThrowOnNextExpand)
        {
            ThrowOnNextExpand = false;
            throw new HttpRequestException("Simulated Gemini outage.");
        }

        var result = NextExpandResult?.Invoke(request)
            ?? new ExpandPromptResult(Declined: false, ExpandedPrompt: $"A detailed, pixel-art rendering of: {request.UserPrompt}", DeclineReason: null);
        NextExpandResult = null;
        return Task.FromResult(result);
    }

    /// <summary>Set by a test before a call to script the next <see cref="GenerateImageAsync"/> result. Reset to the default (a plausible success carrying PNG-signature-only bytes -- NOT a decodable image; a test exercising the real decode-safety path scripts a real one) after each call.</summary>
    public Func<GenerateImageRequest, GenerateImageResult>? NextGenerateResult { get; set; }

    /// <summary>Set by a test to make the next <see cref="GenerateImageAsync"/> call throw, simulating a harness failure (network error, provider outage).</summary>
    public bool ThrowOnNextGenerate { get; set; }

    public Task<GenerateImageResult> GenerateImageAsync(GenerateImageRequest request, CancellationToken ct)
    {
        lock (_generateRequests) _generateRequests.Add(request);

        if (ThrowOnNextGenerate)
        {
            ThrowOnNextGenerate = false;
            throw new HttpRequestException("Simulated Gemini outage.");
        }

        var fakeImage = new GeneratedImage(Bytes: [0x89, 0x50, 0x4E, 0x47], MimeType: "image/png"); // PNG signature bytes only -- not a decodable image, tests that need a real one script NextGenerateResult.
        var result = NextGenerateResult?.Invoke(request)
            ?? new GenerateImageResult(Declined: false, Images: [fakeImage], DeclineReason: null);
        NextGenerateResult = null;
        return Task.FromResult(result);
    }
}
