using Forge.Functions.ArtGen;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.PixelFormats;
using Xunit;

namespace Forge.Tests.Features.ArtGeneration;

/// <summary>
/// Ports <c>tools/art-pipeline/test_chroma_key_extract.py</c>'s own test
/// cases 1:1 against <see cref="ChromaKeyExtractor"/> (docs/adr/0016
/// Decision 4) — same synthetic, deterministic fixtures, same expected
/// numbers, proving the C# port didn't silently diverge from the
/// already-verified-against-real-photos Python original. No Testcontainer,
/// no database, no Docker dependency -- pure in-memory ImageSharp, always
/// runnable regardless of this session's own Docker availability.
/// </summary>
public sealed class ChromaKeyExtractorTests
{
    private static readonly (byte R, byte G, byte B) Magenta = (255, 0, 255);
    private static readonly Rgba32 Red = new(200, 40, 40, 255);

    private static Image<Rgba32> MakeTestImage(int width = 40, int height = 40, (int Left, int Top, int Right, int Bottom)? contentBox = null, Rgba32? contentColor = null)
    {
        var box = contentBox ?? (10, 10, 30, 30);
        var color = contentColor ?? Red;
        var image = new Image<Rgba32>(width, height);
        image.ProcessPixelRows(accessor =>
        {
            for (var y = 0; y < accessor.Height; y++)
            {
                var row = accessor.GetRowSpan(y);
                for (var x = 0; x < row.Length; x++)
                {
                    var inside = x >= box.Left && x < box.Right && y >= box.Top && y < box.Bottom;
                    row[x] = inside ? color : new Rgba32(Magenta.R, Magenta.G, Magenta.B, 255);
                }
            }
        });
        return image;
    }

    [Fact]
    public void Keys_Out_The_Background_To_Full_Transparency()
    {
        using var image = MakeTestImage();
        using var result = ChromaKeyExtractor.Extract(image, new ChromaKeyOptions());
        Assert.Equal(0, result[0, 0].A);
    }

    [Fact]
    public void Leaves_The_Foreground_Content_Fully_Opaque()
    {
        using var image = MakeTestImage();
        using var result = ChromaKeyExtractor.Extract(image, new ChromaKeyOptions());
        var pixel = result[20, 20];
        Assert.Equal(255, pixel.A);
        Assert.Equal((Red.R, Red.G, Red.B), (pixel.R, pixel.G, pixel.B));
    }

    [Fact]
    public void Raises_When_The_Image_Has_No_Key_Colored_Pixels_At_All()
    {
        using var image = new Image<Rgba32>(10, 10, Red);
        Assert.Throws<NoKeyColorFoundException>(() => ChromaKeyExtractor.Extract(image, new ChromaKeyOptions()));
    }

    [Fact]
    public void A_Hard_Cutoff_With_Zero_Feather_Produces_Only_Fully_Transparent_Or_Fully_Opaque_Pixels()
    {
        using var image = MakeTestImage();
        using var result = ChromaKeyExtractor.Extract(image, new ChromaKeyOptions { Feather = 0.0 });
        var alphaValues = new HashSet<byte>();
        result.ProcessPixelRows(accessor =>
        {
            for (var y = 0; y < accessor.Height; y++)
            {
                var row = accessor.GetRowSpan(y);
                foreach (var pixel in row) alphaValues.Add(pixel.A);
            }
        });
        Assert.Equal(new HashSet<byte> { 0, 255 }, alphaValues);
    }

    [Fact]
    public void A_Smaller_Tolerance_Keys_Out_More_Near_Magenta_Pixels()
    {
        // A single true-magenta pixel at (0,0) so the "nothing to key at
        // all" guard never fires; the pixel under test -- near but not
        // exactly magenta -- sits at (1,0). spill((230,30,230)) =
        // (min(230,230) - 30) / 255 ~= 0.784.
        var nearMagenta = new Rgba32(230, 30, 230, 255);
        using var image = new Image<Rgba32>(4, 4, new Rgba32(Magenta.R, Magenta.G, Magenta.B, 255));
        image[1, 0] = nearMagenta;

        using var smallTolerance = ChromaKeyExtractor.Extract(image, new ChromaKeyOptions { Tolerance = 0.1, Feather = 0.0 });
        using var largeTolerance = ChromaKeyExtractor.Extract(image, new ChromaKeyOptions { Tolerance = 0.9, Feather = 0.0 });

        Assert.Equal(0, smallTolerance[1, 0].A);
        Assert.Equal(255, largeTolerance[1, 0].A);
    }

    [Fact]
    public void Unmixes_The_True_Foreground_Color_On_Partially_Transparent_Edge_Pixels()
    {
        // spill((170,94,170)) = (min(170,170)-94)/255 ~= 0.298. tolerance=0.10,
        // feather=0.4 (high=0.50) => transparency = (0.298-0.10)/0.40 ~= 0.495,
        // opacity ~= 0.505 -- comfortably mid-ramp.
        // r = (170 - (1-0.505)*255) / 0.505 ~= 87
        // g = (94  - (1-0.505)*0)   / 0.505 ~= 186
        // b == r by symmetry (key's R and B are both 255).
        var edgePixel = new Rgba32(170, 94, 170, 255);
        using var image = new Image<Rgba32>(4, 4, new Rgba32(Magenta.R, Magenta.G, Magenta.B, 255));
        image[1, 0] = edgePixel;

        using var result = ChromaKeyExtractor.Extract(image, new ChromaKeyOptions { Tolerance = 0.10, Feather = 0.4 });
        var pixel = result[1, 0];

        Assert.True(pixel.A is > 0 and < 255, "this pixel must land in the partial-alpha ramp, not a hard 0/255, for the test to be meaningful");
        Assert.InRange(pixel.R, 84, 90);
        Assert.InRange(pixel.G, 183, 189);
        Assert.InRange(pixel.B, 84, 90);
        Assert.Equal(pixel.R, pixel.B);
    }

    [Fact]
    public void A_Fully_Opaque_Edge_Pixel_Is_Never_Unmixed()
    {
        var foreground = new Rgba32(10, 200, 30, 255);
        using var image = new Image<Rgba32>(4, 4, new Rgba32(Magenta.R, Magenta.G, Magenta.B, 255));
        image[1, 0] = foreground;

        using var result = ChromaKeyExtractor.Extract(image, new ChromaKeyOptions { Tolerance = 0.01, Feather = 0.01 });
        var pixel = result[1, 0];

        Assert.Equal(255, pixel.A);
        Assert.Equal((foreground.R, foreground.G, foreground.B), (pixel.R, pixel.G, pixel.B));
    }

    [Fact]
    public void Crops_Tightly_To_The_Non_Transparent_Bounding_Box_Plus_Padding()
    {
        using var image = MakeTestImage(40, 40, (10, 10, 30, 30));
        using var keyed = ChromaKeyExtractor.Extract(image, new ChromaKeyOptions { Feather = 0.0 });
        using var cropped = ChromaKeyExtractor.CropToContent(keyed, pad: 2);
        // content_box is [10,30) -- a 20x20 region -- plus 2px padding each side => 24x24.
        Assert.Equal(24, cropped.Width);
        Assert.Equal(24, cropped.Height);
    }

    [Fact]
    public void Padding_Is_Clamped_To_The_Image_Bounds_Rather_Than_Erroring()
    {
        using var image = MakeTestImage(40, 40, (0, 0, 5, 5)); // content touches the top-left edge
        using var keyed = ChromaKeyExtractor.Extract(image, new ChromaKeyOptions { Feather = 0.0 });
        using var cropped = ChromaKeyExtractor.CropToContent(keyed, pad: 10); // padding would go negative without clamping
        Assert.True(cropped.Width <= 40);
        Assert.True(cropped.Height <= 40);
    }

    [Fact]
    public void Raises_On_A_Fully_Transparent_Image()
    {
        using var blank = new Image<Rgba32>(10, 10, new Rgba32(0, 0, 0, 0));
        Assert.Throws<InvalidOperationException>(() => ChromaKeyExtractor.CropToContent(blank, pad: 2));
    }
}
