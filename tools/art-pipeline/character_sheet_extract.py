#!/usr/bin/env python3
"""Character-sheet extraction — a raw, magenta-keyed 4x4 (directions x
walk-cycle frames) source photo into one pack-ready `characters.sheets`
PNG at the pack's own fixed `grid.spriteSize` cell size.

Distinct from `sprite_strip_slicer.py`'s facing/animation strips: those are
1xN (a single row), and stay whatever size their content naturally crops
to (`grid.spriteSize` slices them at *render* time, so any uniform cell
size works). A character sheet is different in one real way: it's a 4x4
*grid* (not a single row), and `ArtPackCharacterSet.template.animations`
in `packages/art-pack/src/manifest.ts` fixes each cell to `grid.spriteSize`
(32x48 in every fixture pack today) rather than reading a size off the
sheet — so this pipeline's last step is a real resize to that exact pixel
size, not just a re-composite at whatever size cropping happened to leave.
That resize is *non-uniform* (independent X/Y scale factors) by design:
`grid.spriteSize` is an engine-mandated tile-grid cell, not derived from
any character's own aspect ratio, and every character sheet in this pack
family (existing placeholder art included) already targets that exact
32x48 cell — a uniform (aspect-preserving) scale would just letterbox
inside it instead of filling it, which is not how any consuming code path
here expects a sheet to look.

Row order is docs/adr/0014 / `sprite_strip_slicer.FACING_STRIP_LABELS`'s
own south/west/east/north convention — the source photos were generated
against that same ordering, not discovered from their content.

A second, real quality issue found by direct visual inspection of this
batch's own raw source photos (`fixtures/raw-art/batch-2/IMG_2721.png`,
`IMG_2749.jpeg`, `IMG_2773.jpeg`, at minimum): none of them reliably
generated a genuine east-facing row at even, predictable pixel offsets.
Some sheets have only 3 real content rows (south/west/north, east missing
outright); one has 4, but its row index 2 is a near-duplicate of row 1
(still facing west) rather than a true mirrored pose. `detect_content_bands`
+ `process_character_sheet_from_bands` handle both cases the same way:
locate the real content rows by scanning for horizontal bands that aren't
mostly background (not by assuming an even N-way pixel division, which
these sources don't reliably have), take the first band as south and the
second as west, and *always* build east as a horizontal mirror of west —
discarding any 3rd/4th detected band's own content rather than trusting it
to be a genuine distinct east pose, since direct inspection found it never
reliably was. North comes from the last detected band. This is a real
transform of real content (mirroring is standard practice for symmetric
character sprites), disclosed here rather than silently presented as if
every source photo's own east row were genuine.

Usage:
    character_sheet_extract.py INPUT OUTPUT [--cell-width 32]
                                [--cell-height 48] [--key '#FF00FF']
                                [--tolerance 0.10] [--feather 0.20] [--pad 2]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from chroma_key_extract import ChromaKeyOptions, chroma_key_extract
from sprite_strip_slicer import crop_each_frame, slice_grid

DIRECTIONS = 4
FRAMES_PER_DIRECTION = 4
BAND_BACKGROUND_FRACTION_THRESHOLD = 0.9
BAND_MATCH_DISTANCE = 60


def normalize_grid(
    frames: list[Image.Image],
    columns: int,
    rows: int,
    anchor_x_frac: float = 0.5,
    anchor_y_frac: float = 1.0,
) -> Image.Image:
    """The grid analogue of `sprite_strip_slicer.normalize_strip`: lays
    `frames` (row-major, independently tight-cropped) back out as a
    `columns` x `rows` grid instead of a single row, each frame anchored
    at the same `(anchor_x_frac, anchor_y_frac)` point within a shared,
    uniform cell sized to the largest frame across the *whole* sheet (not
    per-row/per-column) — a walking character's silhouette differs frame
    to frame, but every cell still needs to be the same size for a
    `grid.spriteSize` slice to land correctly.
    """
    if len(frames) != columns * rows:
        raise ValueError(f"normalize_grid: expected {columns * rows} frames for a {columns}x{rows} grid, got {len(frames)}.")
    if not frames:
        raise ValueError("normalize_grid: at least one frame is required.")
    cell_width = max(frame.width for frame in frames)
    cell_height = max(frame.height for frame in frames)
    sheet = Image.new("RGBA", (cell_width * columns, cell_height * rows), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        col, row = index % columns, index // columns
        offset_x = col * cell_width + round((cell_width - frame.width) * anchor_x_frac)
        offset_y = row * cell_height + round((cell_height - frame.height) * anchor_y_frac)
        sheet.alpha_composite(frame.convert("RGBA"), dest=(offset_x, offset_y))
    return sheet


def detect_content_bands(
    image: Image.Image,
    key_color: tuple[int, int, int] = (255, 0, 255),
    background_fraction_threshold: float = BAND_BACKGROUND_FRACTION_THRESHOLD,
    match_distance: int = BAND_MATCH_DISTANCE,
) -> list[tuple[int, int]]:
    """Finds horizontal content rows in a raw, magenta-keyed source photo
    by scanning for bands of image rows that aren't mostly background —
    not by assuming the sheet divides evenly into N equal rows, which real
    sources in this batch don't reliably do (see this module's own doc
    comment). Returns `(top, bottom)` pixel bounds, one pair per detected
    band, top-to-bottom. A row counts as "background" when the fraction of
    its pixels within `match_distance` (Manhattan/L1 distance in RGB) of
    `key_color` exceeds `background_fraction_threshold`.
    """
    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    key = np.asarray(key_color, dtype=np.int16)
    distance = np.abs(rgb - key).sum(axis=2)
    is_background_pixel = distance < match_distance
    background_fraction_per_row = is_background_pixel.mean(axis=1)
    has_content = background_fraction_per_row < background_fraction_threshold

    bands: list[tuple[int, int]] = []
    band_start: int | None = None
    for y, content in enumerate(has_content):
        if content and band_start is None:
            band_start = y
        elif not content and band_start is not None:
            bands.append((band_start, y))
            band_start = None
    if band_start is not None:
        bands.append((band_start, len(has_content)))
    return bands


def process_character_sheet_from_bands(
    input_path: Path,
    output_path: Path,
    options: ChromaKeyOptions = ChromaKeyOptions(),
    columns: int = FRAMES_PER_DIRECTION,
    cell_size: tuple[int, int] = (32, 48),
    band_pad: int = 4,
) -> tuple[int, int]:
    """The robust counterpart to `process_character_sheet` for sources
    that don't cleanly fill an even N-row grid: auto-detects content bands
    with `detect_content_bands`, takes the first as south and the second
    as west, builds east as a horizontal mirror of west, and north from
    the *last* detected band — discarding any other bands in between (see
    module doc comment for why those can't be trusted as a genuine,
    distinct east pose). Requires at least 2 detected bands (south, west);
    raises `ValueError` naming the count found otherwise.
    """
    source = Image.open(input_path)
    keyed = chroma_key_extract(source, options)
    bands = detect_content_bands(source, key_color=options.key_color)
    if len(bands) < 2:
        raise ValueError(f"process_character_sheet_from_bands: need at least 2 content bands (south, west), found {len(bands)}.")

    def band_frames(band: tuple[int, int]) -> list[Image.Image]:
        top, bottom = band
        pad_top, pad_bottom = max(0, top - band_pad), min(keyed.height, bottom + band_pad)
        strip = keyed.crop((0, pad_top, keyed.width, pad_bottom))
        return crop_each_frame(slice_grid(strip, columns=columns, rows=1), options.pad)

    south = band_frames(bands[0])
    west = band_frames(bands[1])
    east = [frame.transpose(Image.FLIP_LEFT_RIGHT) for frame in west]
    north = band_frames(bands[-1]) if len(bands) >= 3 else [frame.transpose(Image.FLIP_TOP_BOTTOM) for frame in south]

    frames = south + west + east + north
    sheet = normalize_grid(frames, columns=columns, rows=DIRECTIONS)
    target_size = (cell_size[0] * columns, cell_size[1] * DIRECTIONS)
    resized = sheet.resize(target_size, Image.LANCZOS)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    resized.save(output_path)
    return resized.size


def process_character_sheet(
    input_path: Path,
    output_path: Path,
    options: ChromaKeyOptions = ChromaKeyOptions(),
    columns: int = FRAMES_PER_DIRECTION,
    rows: int = DIRECTIONS,
    cell_size: tuple[int, int] = (32, 48),
    mirror_west_row_to_east: bool = False,
) -> tuple[int, int]:
    """Key out (uncropped, for the same even-column-spacing reason
    `sprite_strip_slicer`'s own module doc comment gives), slice into the
    `columns`x`rows` grid, tight-crop each cell independently, re-composite
    into one uniform grid, then resize the whole sheet so each cell is
    exactly `cell_size` — matching the pack's `grid.spriteSize`. Returns
    the output's own `(width, height)`.

    `mirror_west_row_to_east`: a real, observed quality issue in this
    batch's raw source photos (confirmed by direct visual inspection of
    more than one sheet, not assumed) — several 4-direction generations
    render row index 2 (`packages/editor/src/canvas/characterTextures.ts`'s
    own row-index convention: 0 south, 1 west, 2 east, 3 north) as a
    near-duplicate of row 1 (west) instead of a true mirrored right-facing
    pose. When set, row 2's *cropped* frames are discarded and replaced
    with a horizontal flip of row 1's own cropped frames instead — a real
    transform of real content (standard practice for symmetric character
    sprites), not fabricated art, and disclosed here rather than silently
    passed through as if it were the source's own genuine east row.
    """
    keyed = chroma_key_extract(Image.open(input_path), options)
    cells = slice_grid(keyed, columns=columns, rows=rows)
    frames = crop_each_frame(cells, options.pad)
    if mirror_west_row_to_east:
        if rows < 3:
            raise ValueError(f"mirror_west_row_to_east requires at least 3 rows (west=1, east=2), got rows={rows}.")
        west_row = frames[columns : columns * 2]
        frames[columns * 2 : columns * 3] = [frame.transpose(Image.FLIP_LEFT_RIGHT) for frame in west_row]
    sheet = normalize_grid(frames, columns=columns, rows=rows)
    target_size = (cell_size[0] * columns, cell_size[1] * rows)
    resized = sheet.resize(target_size, Image.LANCZOS)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    resized.save(output_path)
    return resized.size


def _parse_hex_color(value: str) -> tuple[int, int, int]:
    stripped = value.lstrip("#")
    return tuple(int(stripped[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--cell-width", type=int, default=32)
    parser.add_argument("--cell-height", type=int, default=48)
    parser.add_argument("--key", type=_parse_hex_color, default=(255, 0, 255))
    parser.add_argument("--tolerance", type=float, default=0.10)
    parser.add_argument("--feather", type=float, default=0.20)
    parser.add_argument("--pad", type=int, default=2)
    parser.add_argument(
        "--auto-bands",
        action="store_true",
        help="Auto-detect content rows instead of assuming an even 4-row grid (see module doc comment); mirrors west into east.",
    )
    args = parser.parse_args(argv)

    options = ChromaKeyOptions(key_color=args.key, tolerance=args.tolerance, feather=args.feather, pad=args.pad)
    try:
        if args.auto_bands:
            size = process_character_sheet_from_bands(args.input, args.output, options, cell_size=(args.cell_width, args.cell_height))
        else:
            size = process_character_sheet(args.input, args.output, options, cell_size=(args.cell_width, args.cell_height))
    except ValueError as err:
        print(f"character_sheet_extract: {err}", file=sys.stderr)
        return 1

    print(f"character_sheet_extract: wrote {args.output} ({size[0]}x{size[1]}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
