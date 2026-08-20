"""Unit tests for chroma_key_extract.py — synthetic, deterministic images
only (never the real fixtures/raw-art/ photos: those are for manual
end-to-end verification, not a repeatable assertion, per that directory's
own catalogue of per-file JPEG-compression quirks). Run with:
    python3 -m unittest tools/art-pipeline/test_chroma_key_extract.py -v
"""

import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from chroma_key_extract import (
    ChromaKeyOptions,
    NoKeyColorFoundError,
    chroma_key_extract,
    crop_to_content,
    process_directory,
    process_file,
)

MAGENTA = (255, 0, 255)
RED = (200, 40, 40)


def make_test_image(size: tuple[int, int] = (40, 40), content_box: tuple[int, int, int, int] = (10, 10, 30, 30), content_color=RED) -> Image.Image:
    """A flat-magenta background with a solid-color rectangle in the middle — the simplest real case this pipeline exists for, with a hand-known bounding box to assert crop_to_content against."""
    image = Image.new("RGB", size, MAGENTA)
    pixels = np.array(image)
    left, top, right, bottom = content_box
    pixels[top:bottom, left:right] = content_color
    return Image.fromarray(pixels)


class ChromaKeyExtractTests(unittest.TestCase):
    def test_keys_out_the_background_to_full_transparency(self):
        image = make_test_image()
        result = chroma_key_extract(image)
        pixels = np.array(result)
        self.assertEqual(pixels[0, 0, 3], 0, "a pure-magenta corner pixel must end up fully transparent")

    def test_leaves_the_foreground_content_fully_opaque(self):
        image = make_test_image()
        result = chroma_key_extract(image)
        pixels = np.array(result)
        # Center of the red rectangle.
        self.assertEqual(pixels[20, 20, 3], 255, "a pixel far from the key color must stay fully opaque")
        self.assertEqual(tuple(pixels[20, 20, :3]), RED, "an opaque foreground pixel's own RGB must be untouched")

    def test_raises_when_the_image_has_no_key_colored_pixels_at_all(self):
        image = Image.new("RGB", (10, 10), RED)  # no magenta anywhere
        with self.assertRaises(NoKeyColorFoundError):
            chroma_key_extract(image)

    def test_a_hard_cutoff_with_zero_feather_produces_only_fully_transparent_or_fully_opaque_pixels(self):
        image = make_test_image()
        result = chroma_key_extract(image, ChromaKeyOptions(feather=0.0))
        pixels = np.array(result)
        alpha_values = set(np.unique(pixels[..., 3]).tolist())
        self.assertEqual(alpha_values, {0, 255}, "zero feather must never produce a partial alpha value")

    def test_a_smaller_tolerance_keys_out_more_near_magenta_pixels(self):
        # A single true-magenta pixel at (0, 0) so the "nothing to key at
        # all" guard never fires; the actual pixel under test — near but
        # not exactly magenta — sits at (1, 0), checked on its own.
        # spill((230, 30, 230)) = (min(230, 230) - 30) / 255 ≈ 0.784.
        near_magenta = (230, 30, 230)
        image = Image.new("RGB", (4, 4), MAGENTA)
        pixels = np.array(image)
        pixels[0, 1] = near_magenta
        image = Image.fromarray(pixels)

        # A small tolerance means "even mild spill counts" — more aggressive
        # keying, not less (the spill score is a threshold *for opacity*:
        # below it, opaque; at/above it, transparent).
        small_tolerance = chroma_key_extract(image, ChromaKeyOptions(tolerance=0.1, feather=0.0))
        large_tolerance = chroma_key_extract(image, ChromaKeyOptions(tolerance=0.9, feather=0.0))
        self.assertEqual(np.array(small_tolerance)[0, 1, 3], 0, "a near-magenta pixel must key out under a small tolerance")
        self.assertEqual(np.array(large_tolerance)[0, 1, 3], 255, "the same pixel must stay opaque under a large enough tolerance")

    def test_unmixes_the_true_foreground_color_on_partially_transparent_edge_pixels(self):
        # A true-magenta reference pixel at (0, 0) so the "nothing to key
        # at all" guard never fires; the edge pixel under test — a partial
        # magenta blend, the exact shape a real anti-aliased sprite edge
        # produces — sits at (1, 0).
        #
        # spill((170, 94, 170)) = (min(170, 170) - 94) / 255 ≈ 0.298
        # tolerance=0.10, feather=0.4 (high=0.50) => transparency =
        # (0.298 - 0.10) / 0.40 ≈ 0.495, opacity ≈ 0.505 — comfortably mid-
        # ramp, not close enough to either end to clip after unmixing.
        #
        # Chroma-key compositing model: observed = opacity*foreground +
        # (1-opacity)*key_color. Recovering foreground from underneath
        # that blend:
        #   r = (170 - (1-0.505)*255) / 0.505 ≈ 87
        #   g = (94  - (1-0.505)*0)   / 0.505 ≈ 186  (key's own G is 0, so g is scaled, not shifted)
        #   b = same as r by symmetry (key's R and B are both 255)
        edge_pixel_color = (170, 94, 170)
        image = Image.new("RGB", (4, 4), MAGENTA)
        pixels = np.array(image)
        pixels[0, 1] = edge_pixel_color
        image = Image.fromarray(pixels)

        result = chroma_key_extract(image, ChromaKeyOptions(tolerance=0.10, feather=0.4))
        r, g, b, a = (int(v) for v in np.array(result)[0, 1])
        self.assertTrue(0 < a < 255, "this pixel must land in the partial-alpha ramp, not a hard 0/255, for the test to be meaningful")
        self.assertAlmostEqual(r, 87, delta=3)
        self.assertAlmostEqual(g, 186, delta=3)
        self.assertAlmostEqual(b, 87, delta=3)
        self.assertEqual(r, b, "the key color's R and B are identical (255), so the unmixed foreground's R and B must be too")

    def test_a_fully_opaque_edge_pixel_is_never_unmixed(self):
        # alpha == 1.0 exactly (well past the feather zone) must leave the
        # pixel's own RGB completely unchanged — no division, nothing to
        # recover, since the observed color already *is* the foreground.
        foreground = (10, 200, 30)
        image = Image.new("RGB", (4, 4), MAGENTA)
        pixels = np.array(image)
        pixels[0, 1] = foreground
        image = Image.fromarray(pixels)

        result = chroma_key_extract(image, ChromaKeyOptions(tolerance=0.01, feather=0.01))
        r, g, b, a = (int(v) for v in np.array(result)[0, 1])
        self.assertEqual(a, 255)
        self.assertEqual((r, g, b), foreground)


class CropToContentTests(unittest.TestCase):
    def test_crops_tightly_to_the_non_transparent_bounding_box_plus_padding(self):
        image = make_test_image(size=(40, 40), content_box=(10, 10, 30, 30))
        keyed = chroma_key_extract(image, ChromaKeyOptions(feather=0.0))
        cropped = crop_to_content(keyed, pad=2)
        # content_box is [10,30) — a 20x20 region — plus 2px padding each side => 24x24.
        self.assertEqual(cropped.size, (24, 24))

    def test_padding_is_clamped_to_the_image_bounds_rather_than_erroring(self):
        image = make_test_image(size=(40, 40), content_box=(0, 0, 5, 5))  # content touches the top-left edge
        keyed = chroma_key_extract(image, ChromaKeyOptions(feather=0.0))
        cropped = crop_to_content(keyed, pad=10)  # padding would go negative without clamping
        self.assertEqual(cropped.getbbox() is not None, True)
        # Clamped left/top at 0, so the crop starts at the image's own origin.
        self.assertLessEqual(cropped.width, 40)
        self.assertLessEqual(cropped.height, 40)

    def test_raises_on_a_fully_transparent_image(self):
        blank = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
        with self.assertRaises(ValueError):
            crop_to_content(blank)

    def test_raises_on_a_non_rgba_image(self):
        with self.assertRaises(ValueError):
            crop_to_content(Image.new("RGB", (10, 10), RED))


class ProcessFileAndDirectoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)

    def test_process_file_writes_a_cropped_rgba_png(self):
        input_path = self.tmp_dir / "sprite.png"
        make_test_image().save(input_path)
        output_path = self.tmp_dir / "out" / "sprite.png"

        size = process_file(input_path, output_path, ChromaKeyOptions())

        self.assertTrue(output_path.exists())
        with Image.open(output_path) as saved:
            self.assertEqual(saved.mode, "RGBA")
            self.assertEqual(saved.size, size)
            self.assertLess(saved.size[0], 40, "the output must actually be cropped, not the full 40x40 canvas")

    def test_process_directory_reports_failures_instead_of_raising_and_still_processes_the_rest(self):
        good_path = self.tmp_dir / "good.png"
        make_test_image().save(good_path)
        bad_path = self.tmp_dir / "bad.png"
        Image.new("RGB", (10, 10), RED).save(bad_path)  # no key color at all -> must fail, not crash the batch
        # Non-image file must be silently skipped (not treated as a failure).
        (self.tmp_dir / "README.md").write_text("not an image")

        output_dir = self.tmp_dir / "out"
        failures = process_directory(self.tmp_dir, output_dir, ChromaKeyOptions())

        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0][0].name, "bad.png")
        self.assertTrue((output_dir / "good.png").exists())
        self.assertFalse((output_dir / "bad.png").exists())
        self.assertFalse((output_dir / "README.png").exists())


if __name__ == "__main__":
    unittest.main()
