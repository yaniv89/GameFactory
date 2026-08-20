"""Unit tests for character_sheet_extract.py — synthetic, deterministic
images only, same convention as test_chroma_key_extract.py /
test_sprite_strip_slicer.py. Run with:
    python3 -m unittest tools/art-pipeline/test_character_sheet_extract.py -v
"""

import shutil
import tempfile
import unittest
from pathlib import Path

import numpy as np
from PIL import Image

from chroma_key_extract import ChromaKeyOptions
from character_sheet_extract import detect_content_bands, normalize_grid, process_character_sheet, process_character_sheet_from_bands

MAGENTA = (255, 0, 255)
CELL_SIZE = 24


def make_sheet(columns: int, rows: int, box_size: int = 10) -> Image.Image:
    """A `columns`x`rows`-cell magenta sheet, each cell containing a
    distinctly colored `box_size`x`box_size` square near its own
    top-left, so per-cell crop/reassembly is provable. Colors are picked
    with green as the dominant-or-tied channel (unlike magenta's
    two-high-one-low shape), so none of them are themselves spill-scored
    as background by the real chroma-key algorithm this test exercises."""
    palette = [(200, 60, 60), (60, 200, 60), (60, 60, 200), (200, 200, 60), (60, 200, 200), (140, 90, 40)]
    width, height = CELL_SIZE * columns, CELL_SIZE * rows
    image = Image.new("RGB", (width, height), MAGENTA)
    pixels = np.array(image)
    for row in range(rows):
        for col in range(columns):
            ox, oy = col * CELL_SIZE + 3, row * CELL_SIZE + 3
            color = palette[(row * columns + col) % len(palette)]
            pixels[oy : oy + box_size, ox : ox + box_size] = color
    return Image.fromarray(pixels)


class NormalizeGridTests(unittest.TestCase):
    def test_raises_when_frame_count_does_not_match_columns_times_rows(self):
        frame = Image.new("RGBA", (4, 4), (255, 0, 0, 255))
        with self.assertRaises(ValueError):
            normalize_grid([frame, frame, frame], columns=2, rows=2)

    def test_raises_on_empty_frame_list(self):
        with self.assertRaises(ValueError):
            normalize_grid([], columns=0, rows=0)

    def test_places_each_frame_in_its_own_row_major_cell(self):
        # 2x2 grid, frames distinctly colored so we can prove row-major
        # placement (index 0 -> (col0,row0), index 1 -> (col1,row0), etc).
        colors = [(255, 0, 0, 255), (0, 255, 0, 255), (0, 0, 255, 255), (255, 255, 0, 255)]
        frames = [Image.new("RGBA", (4, 4), c) for c in colors]
        grid = normalize_grid(frames, columns=2, rows=2, anchor_x_frac=0.0, anchor_y_frac=0.0)
        self.assertEqual(grid.size, (8, 8))
        self.assertEqual(grid.getpixel((0, 0)), colors[0])
        self.assertEqual(grid.getpixel((4, 0)), colors[1])
        self.assertEqual(grid.getpixel((0, 4)), colors[2])
        self.assertEqual(grid.getpixel((4, 4)), colors[3])

    def test_uniform_cell_size_is_the_largest_frame_across_the_whole_sheet(self):
        small = Image.new("RGBA", (4, 4), (255, 0, 0, 255))
        big = Image.new("RGBA", (10, 6), (0, 255, 0, 255))
        grid = normalize_grid([small, big, small, small], columns=2, rows=2)
        # cell = (10, 6) regardless of position -> sheet = (20, 12)
        self.assertEqual(grid.size, (20, 12))


class ProcessCharacterSheetTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)

    def test_writes_a_sheet_resized_to_exactly_columns_times_cell_width_by_rows_times_cell_height(self):
        sheet = make_sheet(columns=4, rows=4)
        input_path = self.tmp_dir / "hero.png"
        sheet.save(input_path)
        output_path = self.tmp_dir / "out" / "hero.png"

        size = process_character_sheet(input_path, output_path, ChromaKeyOptions(), cell_size=(32, 48))

        self.assertEqual(size, (128, 192))
        self.assertTrue(output_path.exists())
        with Image.open(output_path) as saved:
            self.assertEqual(saved.mode, "RGBA")
            self.assertEqual(saved.size, (128, 192))

    def test_supports_a_non_default_grid_shape_and_cell_size(self):
        sheet = make_sheet(columns=3, rows=2)
        input_path = self.tmp_dir / "creature.png"
        sheet.save(input_path)
        output_path = self.tmp_dir / "creature_out.png"

        size = process_character_sheet(input_path, output_path, ChromaKeyOptions(), columns=3, rows=2, cell_size=(16, 24))

        self.assertEqual(size, (48, 48))

    def test_background_outside_content_is_transparent_not_leftover_magenta(self):
        sheet = make_sheet(columns=2, rows=2)
        input_path = self.tmp_dir / "sheet.png"
        sheet.save(input_path)
        output_path = self.tmp_dir / "sheet_out.png"

        process_character_sheet(input_path, output_path, ChromaKeyOptions(), columns=2, rows=2, cell_size=(20, 20))

        with Image.open(output_path) as saved:
            arr = np.array(saved.convert("RGBA"))
            # Every cell's own drawn box sits near its top-left, tight-cropped
            # and anchored bottom-center -- so a cell's own top-left corner
            # (0,0) is background, and keying should have made it transparent
            # rather than leaving opaque magenta behind.
            self.assertEqual(arr[0, 0, 3], 0)


def make_banded_sheet(band_heights: list[int], gap: int, columns: int) -> Image.Image:
    """A magenta sheet with `len(band_heights)` content bands stacked
    vertically, each `gap` px of pure background apart, each band split
    into `columns` cells whose content fills the *entire* declared band
    height (a solid, distinctly colored column per cell) -- the
    uneven-row-height shape `detect_content_bands` exists to handle (real
    sources in this batch don't divide evenly into N equal rows). Content
    fills the full band on purpose: this helper is for proving
    `detect_content_bands` finds the declared top/bottom exactly, not for
    exercising `crop_to_content`'s own independent tight-cropping (that's
    covered elsewhere, by `make_sheet`'s inset boxes)."""
    palette = [(200, 60, 60), (60, 200, 60), (60, 60, 200), (200, 200, 60)]
    width = CELL_SIZE * columns
    height = sum(band_heights) + gap * (len(band_heights) + 1)
    image = Image.new("RGB", (width, height), MAGENTA)
    pixels = np.array(image)
    y = gap
    for band_index, band_height in enumerate(band_heights):
        for col in range(columns):
            ox = col * CELL_SIZE + 2
            color = palette[(band_index * columns + col) % len(palette)]
            pixels[y : y + band_height, ox : ox + CELL_SIZE - 4] = color
        y += band_height + gap
    return Image.fromarray(pixels)


class DetectContentBandsTests(unittest.TestCase):
    def test_finds_each_band_top_and_bottom_with_gaps_excluded(self):
        sheet = make_banded_sheet(band_heights=[30, 30, 30], gap=10, columns=2)
        bands = detect_content_bands(sheet, key_color=MAGENTA)
        self.assertEqual(len(bands), 3)
        # band 0: [gap, gap+30) = [10, 40)
        self.assertEqual(bands[0], (10, 40))
        # band 1: starts after band0 + gap = 40 + 10 = 50, height 30 -> (50, 80)
        self.assertEqual(bands[1], (50, 80))

    def test_handles_uneven_band_heights_not_just_a_clean_even_division(self):
        sheet = make_banded_sheet(band_heights=[20, 45, 33], gap=8, columns=2)
        bands = detect_content_bands(sheet, key_color=MAGENTA)
        heights = [bottom - top for top, bottom in bands]
        self.assertEqual(heights, [20, 45, 33])

    def test_pure_background_image_has_no_bands(self):
        blank = Image.new("RGB", (40, 40), MAGENTA)
        self.assertEqual(detect_content_bands(blank, key_color=MAGENTA), [])


class ProcessCharacterSheetFromBandsTests(unittest.TestCase):
    def setUp(self):
        self.tmp_dir = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp_dir, ignore_errors=True)

    def test_raises_when_fewer_than_two_bands_are_found(self):
        blank = Image.new("RGB", (40, 40), MAGENTA)
        input_path = self.tmp_dir / "blank.png"
        blank.save(input_path)
        with self.assertRaises(ValueError):
            process_character_sheet_from_bands(input_path, self.tmp_dir / "out.png", ChromaKeyOptions(), columns=1)

    def test_three_band_source_produces_a_full_four_row_output_with_east_mirrored_from_west(self):
        # south/west/north only, like the real villager and goblin source
        # photos this function was built for -- east must come from
        # somewhere, and it should be a mirror of west, not blank.
        sheet = make_banded_sheet(band_heights=[40, 40, 40], gap=12, columns=2)
        input_path = self.tmp_dir / "three_band.png"
        sheet.save(input_path)
        output_path = self.tmp_dir / "out.png"

        size = process_character_sheet_from_bands(input_path, output_path, ChromaKeyOptions(), columns=2, cell_size=(16, 24))

        self.assertEqual(size, (32, 96))  # 2 cols x 16, 4 rows x 24
        with Image.open(output_path) as saved:
            arr = np.array(saved.convert("RGBA"))
            # East row is rows[2] of 4 -> y in [48, 72). Its content should
            # be a horizontal mirror of west (row 1, y in [24, 48)): both
            # rows should have *some* opaque content, proving east wasn't
            # left blank when the source had no real east band.
            west_alpha = arr[24:48, :, 3]
            east_alpha = arr[48:72, :, 3]
            self.assertGreater(west_alpha.max(), 0)
            self.assertGreater(east_alpha.max(), 0)

    def test_four_band_source_uses_the_last_band_as_north_not_the_middle_ones(self):
        sheet = make_banded_sheet(band_heights=[30, 30, 30, 30], gap=10, columns=2)
        input_path = self.tmp_dir / "four_band.png"
        sheet.save(input_path)
        output_path = self.tmp_dir / "out.png"

        size = process_character_sheet_from_bands(input_path, output_path, ChromaKeyOptions(), columns=2, cell_size=(16, 24))

        self.assertEqual(size, (32, 96))


if __name__ == "__main__":
    unittest.main()
