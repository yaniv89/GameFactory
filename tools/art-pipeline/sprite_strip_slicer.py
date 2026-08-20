#!/usr/bin/env python3
"""L4: sprite-sheet slicers for facing-strip and animation-strip shapes —
docs/adr/0014, task #137.

Feeds off L3's own chroma-key primitives (`chroma_key_extract.py`) rather
than re-implementing keying: this module's whole job is turning one raw,
even-grid, magenta-keyed source photo (docs/adr/0014's "1x4 facing strip"
for `ArtPackWagon`/mounts, "1xN fade animation strip" for `ArtPackVfx`)
into ONE clean, uniform combined strip PNG — the actual shape those two
manifest interfaces' own `src` field expects. Neither interface stores a
per-frame `frameWidth`/`frameHeight` (docs/adr/0014's own decision 3 doc
comment on `ArtPackWagon`): frame slicing at *render* time comes from
`grid.spriteSize` (falling back to `grid.tileSize`), the same source
`characters.sheets` already leans on — this pipeline's job is making sure
that combined strip is actually a clean, evenly-gridded image for that
runtime math to slice correctly, not producing separate per-frame files
Forge would ship.

Pipeline order matters and is the one real design decision here: slicing
into even columns happens against the *chroma-keyed but not yet globally
cropped* image, using `chroma_key_extract()` directly (not
`process_file()`'s crop-included version) — the source photo's own N
columns are evenly spaced across its *original* width by construction (the
prompt template that generated it), so dividing the original width by N is
exact; cropping the *whole* strip to its overall content bounding box
first (as L3's single-asset pipeline does) could shift that even spacing
by a few pixels if one frame's content happens to run further to one edge
than another's, throwing off which pixels belong to which column. Each
column gets its own independent tight crop only *after* it's been sliced
out on its own.

Usage:
    sprite_strip_slicer.py facing INPUT OUTPUT [--key '#FF00FF']
                            [--tolerance 0.10] [--feather 0.20] [--pad 2]
    sprite_strip_slicer.py animation INPUT OUTPUT --frames 5 [same flags]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image

from chroma_key_extract import ChromaKeyOptions, chroma_key_extract, crop_to_content

FACING_STRIP_LABELS = ("south", "west", "east", "north")
FACING_STRIP_COLUMNS = len(FACING_STRIP_LABELS)


def slice_grid(image: Image.Image, columns: int, rows: int = 1) -> list[Image.Image]:
    """Splits `image` into `columns * rows` equal-sized cells, row-major
    (left-to-right, then top-to-bottom) — the raw geometry both facing-
    strip and animation-strip slicing are built on. Raises `ValueError` if
    `image`'s width/height doesn't divide evenly by `columns`/`rows`: a
    lossy off-by-a-fraction-of-a-pixel cell boundary is exactly the kind
    of silent misalignment that would make a runtime `grid.spriteSize`
    slice land on the wrong pixels for every frame after the first — this
    is a real, worth-surfacing authoring-content bug, not a rounding
    detail to shrug off.
    """
    if columns < 1 or rows < 1:
        raise ValueError(f"columns and rows must both be >= 1, got columns={columns} rows={rows}.")
    width, height = image.size
    if width % columns != 0:
        raise ValueError(f"image width {width} does not divide evenly into {columns} columns.")
    if height % rows != 0:
        raise ValueError(f"image height {height} does not divide evenly into {rows} rows.")
    cell_width, cell_height = width // columns, height // rows
    cells: list[Image.Image] = []
    for row in range(rows):
        for col in range(columns):
            left, top = col * cell_width, row * cell_height
            cells.append(image.crop((left, top, left + cell_width, top + cell_height)))
    return cells


def slice_facing_strip(image: Image.Image) -> dict[str, Image.Image]:
    """A 1x4 facing strip, labeled south/west/east/north (docs/adr/0014's
    own ordering for `ArtPackWagon`) — the shape a wagon or mount asset's
    raw source photo takes before this pipeline normalizes it.
    """
    cells = slice_grid(image, columns=FACING_STRIP_COLUMNS)
    return dict(zip(FACING_STRIP_LABELS, cells))


def slice_animation_strip(image: Image.Image, frame_count: int) -> list[Image.Image]:
    """A 1xN fade-animation strip (docs/adr/0014's `ArtPackVfx.frameCount`) — frame count varies per effect, unlike the facing strip's fixed 4."""
    return slice_grid(image, columns=frame_count)


def crop_each_frame(frames: list[Image.Image], pad: int = 2) -> list[Image.Image]:
    """Applies L3's own `crop_to_content` to every frame independently —
    each frame's own tight bounding box, not the strip's overall one (see
    this module's own doc comment for why that distinction matters).
    Raises `ValueError`, with the offending frame's index folded into the
    message, if any single frame is fully transparent (a real content gap
    — a missing pose in a facing strip, a dropped frame in an animation —
    not something to silently paper over with an empty cell).
    """
    result: list[Image.Image] = []
    for index, frame in enumerate(frames):
        try:
            result.append(crop_to_content(frame, pad))
        except ValueError as err:
            raise ValueError(f"frame {index}: {err}") from err
    return result


def normalize_strip(frames: list[Image.Image], anchor_x_frac: float = 0.5, anchor_y_frac: float = 1.0) -> Image.Image:
    """
    Composites frames of potentially different sizes (each independently
    tight-cropped by `crop_each_frame`) into ONE uniform combined strip —
    the actual shape `ArtPackWagon.src`/`ArtPackVfx.src` need: every cell
    the same size (`grid.spriteSize`'s own runtime slicing assumes a
    uniform cell width), with each frame's own content placed at a
    consistent anchor point within its cell rather than left at whatever
    size/position its own individual crop happened to produce.

    `anchor_x_frac`/`anchor_y_frac` are fractions of the cell (0,0 =
    top-left, 1,1 = bottom-right) that each frame's own same-fraction
    point gets aligned to — the default (0.5, 1.0), horizontally centered
    and bottom-aligned, is a ground-contact/grip point's natural resting
    place, the same shape every one of docs/adr/0014's five new
    categories declares its own single `ArtPackAnchor` for.
    """
    if not frames:
        raise ValueError("normalize_strip: at least one frame is required.")
    cell_width = max(frame.width for frame in frames)
    cell_height = max(frame.height for frame in frames)
    strip = Image.new("RGBA", (cell_width * len(frames), cell_height), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        offset_x = index * cell_width + round((cell_width - frame.width) * anchor_x_frac)
        offset_y = round((cell_height - frame.height) * anchor_y_frac)
        strip.alpha_composite(frame.convert("RGBA"), dest=(offset_x, offset_y))
    return strip


def process_facing_strip(input_path: Path, output_path: Path, options: ChromaKeyOptions = ChromaKeyOptions()) -> tuple[int, int]:
    """Full pipeline for a wagon/mount source photo: key out (uncropped),
    slice into the 4 facing cells, tight-crop each independently, and
    re-composite into one uniform strip. Returns the output's own
    `(width, height)`.
    """
    keyed = chroma_key_extract(Image.open(input_path), options)
    frames = list(slice_facing_strip(keyed).values())
    strip = normalize_strip(crop_each_frame(frames, options.pad))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    strip.save(output_path)
    return strip.size


def process_animation_strip(input_path: Path, output_path: Path, frame_count: int, options: ChromaKeyOptions = ChromaKeyOptions()) -> tuple[int, int]:
    """The same pipeline as `process_facing_strip`, for a VFX source photo with `frame_count` frames instead of a fixed 4."""
    keyed = chroma_key_extract(Image.open(input_path), options)
    frames = slice_animation_strip(keyed, frame_count)
    strip = normalize_strip(crop_each_frame(frames, options.pad))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    strip.save(output_path)
    return strip.size


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    subparsers = parser.add_subparsers(dest="shape", required=True)

    def add_common_flags(subparser: argparse.ArgumentParser) -> None:
        subparser.add_argument("input", type=Path)
        subparser.add_argument("output", type=Path)
        subparser.add_argument("--key", type=lambda v: tuple(int(v.lstrip("#")[i : i + 2], 16) for i in (0, 2, 4)), default=(255, 0, 255))
        subparser.add_argument("--tolerance", type=float, default=0.10)
        subparser.add_argument("--feather", type=float, default=0.20)
        subparser.add_argument("--pad", type=int, default=2)

    facing_parser = subparsers.add_parser("facing", help="Slice a 1x4 facing strip (south/west/east/north).")
    add_common_flags(facing_parser)

    animation_parser = subparsers.add_parser("animation", help="Slice a 1xN animation strip.")
    add_common_flags(animation_parser)
    animation_parser.add_argument("--frames", type=int, required=True, help="Frame count in the source strip.")

    args = parser.parse_args(argv)
    options = ChromaKeyOptions(key_color=args.key, tolerance=args.tolerance, feather=args.feather, pad=args.pad)

    try:
        if args.shape == "facing":
            size = process_facing_strip(args.input, args.output, options)
        else:
            size = process_animation_strip(args.input, args.output, args.frames, options)
    except ValueError as err:
        print(f"sprite_strip_slicer: {err}", file=sys.stderr)
        return 1

    print(f"sprite_strip_slicer: wrote {args.output} ({size[0]}x{size[1]}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
