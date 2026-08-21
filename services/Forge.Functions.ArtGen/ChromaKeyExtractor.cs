using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using SixLabors.ImageSharp.Processing;

namespace Forge.Functions.ArtGen;

/// <summary>
/// docs/adr/0016 Decision 4: a C#/ImageSharp port of
/// <c>tools/art-pipeline/chroma_key_extract.py</c>'s algorithm — same
/// spill-score math, same alpha-unmixing spill suppression, same
/// crop-to-content, ported rather than reimplemented from scratch. That
/// Python script's own docstring documents the one real correctness fix
/// this session already found the hard way (by actually looking at
/// output on real photos, not just synthetic unit tests): plain
/// Euclidean RGB distance to the key color misses a *dark* magenta
/// remnant (a shadow near a sprite's own silhouette) because it sits far
/// from full-brightness magenta in raw distance despite being clearly
/// magenta-tinted. The spill-score metric below is brightness-independent
/// for exactly that reason — porting it wrong here would silently
/// reintroduce a bug this session already paid to find and fix once.
/// </summary>
public sealed record ChromaKeyOptions
{
    public (byte R, byte G, byte B) KeyColor { get; init; } = (255, 0, 255);

    public double Tolerance { get; init; } = 0.10;

    public double Feather { get; init; } = 0.20;

    public int Pad { get; init; } = 2;
}

/// <summary>Raised when an image has no pixels within range of the key color at all — almost always the wrong input (a terrain tile, which docs/adr/0014 already notes isn't chroma-keyed at all), not something to silently pass through unchanged.</summary>
public sealed class NoKeyColorFoundException(string message) : Exception(message);

public static class ChromaKeyExtractor
{
    /// <summary>
    /// Keys <paramref name="options"/>'s <c>KeyColor</c> out to real alpha
    /// and spill-suppresses the edge — does not crop (see
    /// <see cref="CropToContent"/>, applied separately so a caller who
    /// only wants the alpha channel isn't forced into a crop too, same
    /// split as the Python original). Returns a new image; the input is
    /// not modified. Throws <see cref="NoKeyColorFoundException"/> if no
    /// pixel is within <c>options.Tolerance</c> of the key color at all.
    /// </summary>
    public static Image<Rgba32> Extract(Image<Rgba32> source, ChromaKeyOptions options)
    {
        var (loIndex, hiIndex1, hiIndex2) = KeyChannelRoles(options.KeyColor);
        var key = options.KeyColor;
        var low = options.Tolerance;
        var high = options.Tolerance + options.Feather;
        var hardCutoff = high <= low;

        var result = new Image<Rgba32>(source.Width, source.Height);
        var anySpillAboveTolerance = false;

        source.ProcessPixelRows(result, (sourceAccessor, resultAccessor) =>
        {
            for (var y = 0; y < sourceAccessor.Height; y++)
            {
                var sourceRow = sourceAccessor.GetRowSpan(y);
                var resultRow = resultAccessor.GetRowSpan(y);
                for (var x = 0; x < sourceRow.Length; x++)
                {
                    var pixel = sourceRow[x];
                    Span<byte> channels = [pixel.R, pixel.G, pixel.B];

                    var hiMin = Math.Min(channels[hiIndex1], channels[hiIndex2]);
                    var lo = channels[loIndex];
                    var spill = (hiMin - lo) / 255.0;

                    if (spill >= options.Tolerance) anySpillAboveTolerance = true;

                    double transparency;
                    if (hardCutoff)
                    {
                        transparency = spill >= low ? 1.0 : 0.0;
                    }
                    else
                    {
                        transparency = Math.Clamp((spill - low) / (high - low), 0.0, 1.0);
                    }

                    var opacity = 1.0 - transparency;
                    var alphaByte = (byte)Math.Round(opacity * 255.0);

                    // docs/adr/0016 Decision 4 / the Python original's own
                    // _suppress_spill doc comment: a real alpha-unmix, not
                    // a naive channel-dim -- observed = alpha*foreground +
                    // (1-alpha)*key, solved for foreground. Left untouched
                    // (copy the source channel) for a fully opaque pixel;
                    // every channel rescaled for anything less, since the
                    // blend model applies uniformly across R/G/B.
                    byte outR, outG, outB;
                    if (opacity >= 1.0)
                    {
                        outR = pixel.R;
                        outG = pixel.G;
                        outB = pixel.B;
                    }
                    else
                    {
                        var alphaSafe = Math.Max(opacity, 1e-3);
                        outR = UnmixChannel(pixel.R, key.R, alphaSafe);
                        outG = UnmixChannel(pixel.G, key.G, alphaSafe);
                        outB = UnmixChannel(pixel.B, key.B, alphaSafe);
                    }

                    resultRow[x] = new Rgba32(outR, outG, outB, alphaByte);
                }
            }
        });

        if (!anySpillAboveTolerance)
        {
            result.Dispose();
            throw new NoKeyColorFoundException(
                $"no pixel with a spill score >= tolerance {options.Tolerance} for key color " +
                $"({key.R},{key.G},{key.B}) -- wrong input (not chroma-keyed), or tolerance is too tight.");
        }

        return result;
    }

    /// <summary>
    /// Tight-crops <paramref name="image"/> to the bounding box of pixels
    /// with any non-zero alpha, plus <paramref name="pad"/> pixels of
    /// margin on every side (clamped to the image's own bounds). Throws
    /// <see cref="InvalidOperationException"/> if every pixel is fully
    /// transparent -- a crop with nothing to crop to is a bug in the
    /// caller, not a 0x0 image to silently produce (same as the Python
    /// original's own <c>ValueError</c>).
    /// </summary>
    public static Image<Rgba32> CropToContent(Image<Rgba32> image, int pad)
    {
        var minX = int.MaxValue;
        var minY = int.MaxValue;
        var maxX = -1;
        var maxY = -1;

        image.ProcessPixelRows(accessor =>
        {
            for (var y = 0; y < accessor.Height; y++)
            {
                var row = accessor.GetRowSpan(y);
                for (var x = 0; x < row.Length; x++)
                {
                    if (row[x].A == 0) continue;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        });

        if (maxX < 0 || maxY < 0)
        {
            throw new InvalidOperationException("image is fully transparent -- nothing to crop to.");
        }

        var left = Math.Max(0, minX - pad);
        var top = Math.Max(0, minY - pad);
        var right = Math.Min(image.Width - 1, maxX + pad);
        var bottom = Math.Min(image.Height - 1, maxY + pad);

        return image.Clone(ctx => ctx.Crop(new Rectangle(left, top, right - left + 1, bottom - top + 1)));
    }

    private static byte UnmixChannel(byte observed, byte key, double alphaSafe)
    {
        var unmixed = (observed - (1.0 - alphaSafe) * key) / alphaSafe;
        return (byte)Math.Clamp(Math.Round(unmixed), 0, 255);
    }

    /// <summary>
    /// Splits <paramref name="keyColor"/>'s three channels into the one it
    /// *doesn't* elevate (<c>loIndex</c>) and the two it does (<c>hi1</c>/
    /// <c>hi2</c>) -- magenta (255,0,255) is G-low/R,B-high. Same "one
    /// low, two high" shape restriction the Python original documents:
    /// tuned for magenta specifically, not a generic key-color solver.
    /// </summary>
    private static (int loIndex, int hi1, int hi2) KeyChannelRoles((byte R, byte G, byte B) keyColor)
    {
        Span<byte> channels = [keyColor.R, keyColor.G, keyColor.B];
        var loIndex = 0;
        for (var i = 1; i < 3; i++)
        {
            if (channels[i] < channels[loIndex]) loIndex = i;
        }
        Span<int> hi = stackalloc int[2];
        var hiCount = 0;
        for (var i = 0; i < 3; i++)
        {
            if (i != loIndex) hi[hiCount++] = i;
        }
        return (loIndex, hi[0], hi[1]);
    }
}
