"""Unit tests for sprite_strip_slicer.py — synthetic, deterministic images
only, same convention as test_chroma_key_extract.py. Run with:
    python3 -m unittest tools/art-pipeline/test_sprite_strip_slicer.py -v
"""

import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from chroma_key_extract import ChromaKeyOptions
from sprite_strip_slicer import (
    FACING_STRIP_LABELS,
    crop_each_frame,
    normalize_strip,
    process_animation_strip,
    process_facing_strip,
    slice_animation_strip,
    slice_facing_strip,
    slice_grid,
)

MAGENTA = (255, 0, 255)
CELL_SIZE = 20


def make_strip(colors_and_boxes: list[tuple[tuple[int, int, int], tuple[int, int, int, int]]]) -> Image.Image:
    """A `len(colors_and_boxes)`-cell, `CELL_SIZE`-wide-per-cell magenta strip, each cell containing a solid rectangle at its own color/box (box is cell-local coordinates)."""
    width = CELL_SIZE * len(colors_and_boxes)
    image = Image.new("RGB", (width, CELL_SIZE), MAGENTA)
    pixels = np.array(image)
    for index, (color, (left, top, right, bottom)) in enumerate(colors_and_boxes):
        offset = index * CELL_SIZE
        pixels[top:bottom, offset + left : offset + right] = color
    return Image.fromarray(pixels)


class SliceGridTests(unittest.TestCase):
    def test_slices_into_the_requested_number_of_equal_width_columns(self):
        image = Image.new("RGB", (40, 10), MAGENTA)
        cells = slice_grid(image, columns=4)
        self.assertEqual(len(cells), 4)
        self.assertTrue(all(cell.size == (10, 10) for cell in cells))

    def test_slices_a_grid_of_columns_and_rows(self):
        image = Image.new("RGB", (40, 20), MAGENTA)
        cells = slice_grid(image, columns=4, rows=2)
        self.assertEqual(len(cells), 8)
        self.assertTrue(all(cell.size == (10, 10) for cell in cells))

    def test_cells_are_in_row_major_order(self):
        # Two cells side by side, distinctly colored, so ordering is provable.
        image = Image.new("RGB", (20, 10), MAGENTA)
        pixels = np.array(image)
        pixels[:, :10] = (255, 0, 0)  # left cell red
        pixels[:, 10:] = (0, 255, 0)  # right cell green
        image = Image.fromarray(pixels)
        cells = slice_grid(image, columns=2)
        self.assertEqual(cells[0].getpixel((0, 0)), (255, 0, 0))
        self.assertEqual(cells[1].getpixel((0, 0)), (0, 255, 0))

    def test_raises_when_width_does_not_divide_evenly(self):
        image = Image.new("RGB", (41, 10), MAGENTA)
        with self.assertRaises(ValueError):
            slice_grid(image, columns=4)

    def test_raises_on_zero_or_negative_columns_or_rows(self):
        image = Image.new("RGB", (40, 10), MAGENTA)
        with self.assertRaises(ValueError):
            slice_grid(image, columns=0)
        with self.assertRaises(ValueError):
            slice_grid(image, rows=-1, columns=4)


class FacingAndAnimationStripTests(unittest.TestCase):
    def test_slice_facing_strip_returns_four_labeled_cells_in_the_documented_order(self):
        image = Image.new("RGB", (CELL_SIZE * 4, CELL_SIZE), MAGENTA)
        result = slice_facing_strip(image)
        self.assertEqual(list(result.keys()), list(FACING_STRIP_LABELS))
        self.assertEqual(list(result.keys()), ["south", "west", "east", "north"])

    def test_slice_animation_strip_returns_frame_count_cells(self):
        image = Image.new("RGB", (CELL_SIZE * 5, CELL_SIZE), MAGENTA)
        result = slice_animation_strip(image, frame_count=5)
        self.assertEqual(len(result), 5)


class CropEachFrameTests(unittest.TestCase):
    def test_crops_every_frame_to_its_own_content_independently(self):
        strip = make_strip(
            [
                ((200, 40, 40), (2, 2, 8, 8)),  # small box near the top-left of its cell
                ((40, 200, 40), (5, 10, 18, 18)),  # bigger box near the bottom-right of its cell
            ]
        )
        keyed_frames = [Image.new("RGBA", (CELL_SIZE, CELL_SIZE), (0, 0, 0, 0)) for _ in range(2)]
        # Build genuinely-keyed RGBA frames by hand (this test is about
        # crop_each_frame, not chroma_key_extract — already covered by
        # test_chroma_key_extract.py — so alpha is set directly here).
        cells = slice_grid(strip, columns=2)
        for i, cell in enumerate(cells):
            rgba = cell.convert("RGBA")
            arr = np.array(rgba)
            is_magenta = np.all(arr[..., :3] == MAGENTA, axis=-1)
            arr[..., 3] = np.where(is_magenta, 0, 255)
            keyed_frames[i] = Image.fromarray(arr)

        cropped = crop_each_frame(keyed_frames, pad=0)
        self.assertEqual(cropped[0].size, (6, 6))  # box (2,2,8,8) -> 6x6
        self.assertEqual(cropped[1].size, (13, 8))  # box (5,10,18,18) -> 13x8

    def test_raises_with_the_offending_frame_index_when_a_frame_is_fully_transparent(self):
        blank = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
        opaque = Image.new("RGBA", (10, 10), (255, 0, 0, 255))
        with self.assertRaises(ValueError) as ctx:
            crop_each_frame([opaque, blank])
        self.assertIn("frame 1", str(ctx.exception))


class NormalizeStripTests(unittest.TestCase):
    def test_produces_one_uniform_strip_sized_to_the_largest_frame(self):
        small = Image.new("RGBA", (4, 4), (255, 0, 0, 255))
        large = Image.new("RGBA", (10, 8), (0, 255, 0, 255))
        strip = normalize_strip([small, large])
        self.assertEqual(strip.size, (20, 8))  # 2 cells of 10x8 each

    def test_bottom_center_anchor_places_each_frame_at_the_bottom_of_its_cell(self):
        frame = Image.new("RGBA", (4, 4), (255, 0, 0, 255))
        taller = Image.new("RGBA", (4, 10), (0, 255, 0, 255))
        strip = normalize_strip([frame, taller], anchor_x_frac=0.5, anchor_y_frac=1.0)
        # frame's cell is (4, 10); its 4px content should sit flush at the
        # bottom (rows 6..9 opaque, rows 0..5 transparent in that cell).
        cell = strip.crop((0, 0, 4, 10))
        alpha = np.array(cell)[..., 3]
        self.assertTrue(np.all(alpha[:6] == 0), "content must not appear above the anchor position")
        self.assertTrue(np.all(alpha[6:] == 255), "content must fill flush to the bottom of the cell")

    def test_raises_on_an_empty_frame_list(self):
        with self.assertRaises(ValueError):
            normalize_strip([])


class ProcessFacingAndAnimationStripTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)

    def test_process_facing_strip_writes_a_four_cell_uniform_strip(self):
        strip = make_strip(
            [
                ((200, 40, 40), (5, 5, 15, 15)),
                ((40, 200, 40), (5, 5, 15, 15)),
                ((40, 40, 200), (5, 5, 15, 15)),
                ((200, 200, 40), (5, 5, 15, 15)),
            ]
        )
        input_path = self.tmp_dir / "wagon.png"
        strip.save(input_path)
        output_path = self.tmp_dir / "out" / "wagon.png"

        size = process_facing_strip(input_path, output_path, ChromaKeyOptions())

        self.assertTrue(output_path.exists())
        self.assertEqual(size[0] % 4, 0, "the output strip's width must divide evenly into 4 uniform cells")
        with Image.open(output_path) as saved:
            self.assertEqual(saved.mode, "RGBA")
            self.assertEqual(saved.size, size)

    def test_process_animation_strip_writes_a_frame_count_cell_uniform_strip(self):
        strip = make_strip([((200, 40, 40), (5, 5, 15, 15)) for _ in range(5)])
        input_path = self.tmp_dir / "spark.png"
        strip.save(input_path)
        output_path = self.tmp_dir / "spark_out.png"

        size = process_animation_strip(input_path, output_path, frame_count=5, options=ChromaKeyOptions())

        self.assertEqual(size[0] % 5, 0, "the output strip's width must divide evenly into 5 uniform cells")


if __name__ == "__main__":
    unittest.main()
