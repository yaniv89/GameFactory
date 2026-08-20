#!/usr/bin/env python3
"""L3: chroma-key asset extraction — docs/adr/0014, task #136.

Turns one raw, magenta-keyed source image (fixtures/raw-art/ — "magenta-key
(#FF00FF) backgrounds where applicable, un-cropped, un-sliced" per that
directory's own README) into a pack-ready transparent PNG: the magenta
background becomes real alpha, the edge fringe the key color leaves behind
gets suppressed instead of staying visible as a magenta halo, and the
result is cropped tight to the actual sprite content instead of shipping a
mostly-empty 1024x1024 canvas.

Explicitly NOT this script's job: slicing a facing-strip or animation-strip
into individual frames (that's L4, task #137, a separate pipeline stage
this one's output feeds into) and terrain tiles (they aren't chroma-keyed
at all — they tile the full frame, nothing here would find a background to
key out, and running this on one would be a no-op at best).

Usage:
    chroma_key_extract.py INPUT OUTPUT [--key '#FF00FF'] [--tolerance 0.10]
                           [--feather 0.20] [--pad 2]
    chroma_key_extract.py INPUT_DIR OUTPUT_DIR --batch [same flags]

Exit code is non-zero if INPUT has no key-colored pixels within `tolerance`
at all (nothing to key out is almost always a sign of the wrong input, a
tile image, or a tolerance that's too tight) — not a silent no-op.
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class ChromaKeyOptions:
    """`tolerance`/`feather` are both a fraction of the maximum possible
    per-channel spread (255), not raw pixel units — this keeps the two
    numbers meaningful regardless of 8-bit vs. any other future bit depth,
    and keeps the CLI defaults small, readable numbers instead of
    triple-digit pixel figures. A pixel whose "spill score" (`_spill_score`,
    below — how much it skews toward the key color's own hue, independent
    of the pixel's own brightness) is below `tolerance` is left fully
    opaque; a pixel at or above `tolerance + feather` is fully transparent;
    everything between is a real alpha ramp, not a hard edge.

    Deliberately NOT plain Euclidean RGB distance to `key_color` — that was
    the first implementation, and it missed real spill: a *dark* magenta
    remnant (e.g. a shadow cast near the sprite's own silhouette, or a dark
    outline color mixed with a sliver of key color) sits far from
    full-brightness magenta in raw RGB terms even though it's clearly
    magenta-*tinted*, so distance-to-key alone left a visible fringe around
    every real fixtures/raw-art/ sprite tested against it — caught by
    actually looking at the output, not assumed correct from unit tests on
    synthetic full-brightness pixels alone.
    """

    key_color: tuple[int, int, int] = (255, 0, 255)
    tolerance: float = 0.10
    feather: float = 0.20
    pad: int = 2


class NoKeyColorFoundError(RuntimeError):
    """Raised when an image has no pixels within range of the key color at all — almost always the wrong input, not something to silently pass through unchanged."""


def _key_channel_roles(key_color: tuple[int, int, int]) -> tuple[int, tuple[int, int]]:
    """Splits `key_color`'s three channels into the one it *doesn't*
    elevate (`lo_index`) and the two it does (`hi_indices`) — magenta
    (255, 0, 255) is G-low/R,B-high; this module is built around that
    "one low, two high" shape specifically, since that's the only key
    color docs/adr/0014 and fixtures/raw-art/README.md's own prompt
    catalog actually use. A green-screen-shaped key (one high, two low)
    would need the opposite split — out of scope here, not silently
    mishandled: `--key` still accepts any hex value for flexibility, but
    the spill math is tuned for magenta's own channel shape, not generic.
    """
    lo_index = int(np.argmin(key_color))
    hi_indices = tuple(i for i in range(3) if i != lo_index)
    return lo_index, (hi_indices[0], hi_indices[1])


def _spill_score(pixels: np.ndarray, key_color: tuple[int, int, int]) -> np.ndarray:
    """
    How strongly each pixel skews toward `key_color`'s own hue, as a
    brightness-independent ratio rather than absolute distance: for
    magenta, `min(R, B) - G`, normalized to roughly [-1, 1]. A pure
    magenta pixel scores 1.0; a neutral gray or a color where G is the
    dominant channel scores 0 or negative (genuinely no magenta content);
    a *dark* magenta remnant — low absolute brightness, but R and B still
    both clearly exceed G — still scores solidly positive, which is
    exactly the case plain RGB-distance-to-key missed (see
    `ChromaKeyOptions`'s own doc comment).
    """
    lo_index, hi_indices = _key_channel_roles(key_color)
    p = pixels.astype(np.float64)
    hi_min = np.minimum(p[..., hi_indices[0]], p[..., hi_indices[1]])
    lo = p[..., lo_index]
    return (hi_min - lo) / 255.0


def _alpha_ramp(spill: np.ndarray, options: ChromaKeyOptions) -> np.ndarray:
    """0.0 (fully opaque) at `spill <= tolerance`, 1.0 (fully transparent)
    at `spill >= tolerance + feather` — a real ramp, not a hard threshold,
    so an anti-aliased sprite edge doesn't get a visible cliff between
    "fully transparent" and "fully opaque." Returns the *transparency*
    fraction (0 = opaque, 1 = transparent) to match how `chroma_key_extract`
    turns it directly into an alpha channel below (`alpha = 255 * (1 -
    transparency)`).
    """
    low, high = options.tolerance, options.tolerance + options.feather
    if high <= low:
        # feather == 0: a hard cutoff is a legitimate, deliberate choice
        # (some callers may want exact-match keying), not an error.
        return (spill >= low).astype(np.float64)
    ramp = (spill - low) / (high - low)
    return np.clip(ramp, 0.0, 1.0)


def _suppress_spill(rgb: np.ndarray, key_color: tuple[int, int, int], alpha: np.ndarray) -> np.ndarray:
    """
    Un-mixes a partially-transparent edge pixel's true foreground color out
    from underneath the key-color blend it visibly still carries — a naive
    "just dim the elevated channels" heuristic was tried first and left a
    faint but real magenta halo around every sprite edge in a genuine
    fixtures/raw-art/ image (caught by looking at the actual output, not
    assumed correct from the unit tests alone).

    The source photo's own edge pixels are a real optical blend, not
    already-transparent pixels: `observed = alpha*foreground +
    (1-alpha)*key_color`, the standard chroma-key compositing model. Given
    the `alpha` this module already computed from color distance, the
    foreground the photo actually shows under that blend is recovered by
    solving that equation for `foreground` — not clamping/dimming, actually
    inverting the blend — which is what removes the fringe instead of just
    softening it. Left untouched for a fully opaque pixel (`alpha == 1`,
    no division needed, nothing to unmix); for anything else, every
    channel is rescaled, not just the ones the key color itself elevates,
    since the blend model applies uniformly across R/G/B.
    """
    key = np.array(key_color, dtype=np.float64)
    observed = rgb.astype(np.float64)
    alpha_safe = np.maximum(alpha, 1e-3)[..., np.newaxis]
    unmixed = (observed - (1.0 - alpha_safe) * key) / alpha_safe
    is_edge = (alpha < 1.0)[..., np.newaxis]
    result = np.where(is_edge, unmixed, observed)
    return np.clip(result, 0, 255).astype(np.uint8)


def chroma_key_extract(image: Image.Image, options: ChromaKeyOptions = ChromaKeyOptions()) -> Image.Image:
    """Returns a new RGBA image with `options.key_color` keyed out to real
    alpha and spill-suppressed at the edge — does not crop (see
    `crop_to_content`, applied separately by `process_file`/`process_directory`
    so a caller who only wants the alpha channel isn't forced into a crop
    too). Raises `NoKeyColorFoundError` if no pixel in `image` is within
    `options.tolerance` of the key color at all.
    """
    rgb_image = image.convert("RGB")
    pixels = np.array(rgb_image)
    spill = _spill_score(pixels, options.key_color)

    if not np.any(spill >= options.tolerance):
        raise NoKeyColorFoundError(
            f"no pixel with a spill score >= tolerance {options.tolerance} for key color {options.key_color} — "
            "wrong input (not chroma-keyed), or tolerance is too tight."
        )

    transparency = _alpha_ramp(spill, options)
    opacity = 1.0 - transparency
    alpha = (opacity * 255).astype(np.uint8)
    rgb_out = _suppress_spill(pixels, options.key_color, opacity)

    rgba = np.dstack([rgb_out, alpha])
    return Image.fromarray(rgba, mode="RGBA")


def crop_to_content(image: Image.Image, pad: int = 2) -> Image.Image:
    """Tight-crops `image` (must be RGBA) to the bounding box of pixels
    with any non-zero alpha, plus `pad` pixels of margin on every side
    (clamped to the image's own bounds). Raises `ValueError` if every
    pixel is fully transparent — a crop with nothing to crop to is a bug
    in the caller, not a 0x0 image to silently produce.
    """
    if image.mode != "RGBA":
        raise ValueError(f"crop_to_content expects an RGBA image, got mode {image.mode!r}.")
    alpha = np.array(image)[..., 3]
    rows = np.any(alpha > 0, axis=1)
    cols = np.any(alpha > 0, axis=0)
    if not np.any(rows) or not np.any(cols):
        raise ValueError("image is fully transparent — nothing to crop to.")
    top, bottom = np.where(rows)[0][[0, -1]]
    left, right = np.where(cols)[0][[0, -1]]
    height, width = alpha.shape
    top = max(0, int(top) - pad)
    left = max(0, int(left) - pad)
    bottom = min(height - 1, int(bottom) + pad)
    right = min(width - 1, int(right) + pad)
    return image.crop((left, top, right + 1, bottom + 1))


def process_file(input_path: Path, output_path: Path, options: ChromaKeyOptions) -> tuple[int, int]:
    """Runs the full pipeline on one file: key out, suppress spill, crop.
    Returns the output image's own (width, height) for the caller to log.
    """
    image = Image.open(input_path)
    keyed = chroma_key_extract(image, options)
    cropped = crop_to_content(keyed, options.pad)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(output_path)
    return cropped.size


def process_directory(input_dir: Path, output_dir: Path, options: ChromaKeyOptions) -> list[tuple[Path, str]]:
    """Processes every `.png`/`.jpg`/`.jpeg` in `input_dir` (non-recursive —
    matches fixtures/raw-art/'s own flat-per-batch layout), writing each
    result to `output_dir` under the same filename with a `.png` extension.
    Returns `(input_path, error_message)` for every file that failed,
    instead of raising on the first one — a batch run over dozens of real,
    imperfect source photos (fixtures/raw-art/README.md's own catalogued
    per-file issues) needs to report every failure, not stop at the first.
    """
    failures: list[tuple[Path, str]] = []
    for input_path in sorted(input_dir.iterdir()):
        if input_path.suffix.lower() not in (".png", ".jpg", ".jpeg"):
            continue
        output_path = output_dir / (input_path.stem + ".png")
        try:
            process_file(input_path, output_path, options)
        except (NoKeyColorFoundError, ValueError) as err:
            failures.append((input_path, str(err)))
    return failures


def _parse_hex_color(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    if len(value) != 6:
        raise argparse.ArgumentTypeError(f"'{value}' is not a 6-digit hex color, e.g. 'FF00FF'.")
    try:
        return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))
    except ValueError as err:
        raise argparse.ArgumentTypeError(f"'{value}' is not a valid hex color.") from err


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", type=Path, help="Source image file, or a directory when --batch is set.")
    parser.add_argument("output", type=Path, help="Output PNG file, or a directory when --batch is set.")
    parser.add_argument("--batch", action="store_true", help="Treat input/output as directories and process every image in input non-recursively.")
    parser.add_argument("--key", type=_parse_hex_color, default=(255, 0, 255), help="Key color as hex, e.g. FF00FF (default: FF00FF).")
    parser.add_argument("--tolerance", type=float, default=0.10, help="Spill score below which a pixel is left fully opaque (default: 0.10).")
    parser.add_argument("--feather", type=float, default=0.20, help="Spill-score range over which alpha ramps from opaque to transparent, starting at --tolerance (default: 0.20).")
    parser.add_argument("--pad", type=int, default=2, help="Pixels of margin kept around the cropped content (default: 2).")
    args = parser.parse_args(argv)

    options = ChromaKeyOptions(key_color=args.key, tolerance=args.tolerance, feather=args.feather, pad=args.pad)

    if args.batch:
        failures = process_directory(args.input, args.output, options)
        processed = sum(1 for p in sorted(args.input.iterdir()) if p.suffix.lower() in (".png", ".jpg", ".jpeg")) - len(failures)
        print(f"chroma_key_extract: {processed} succeeded, {len(failures)} failed.")
        for path, message in failures:
            print(f"  FAIL {path.name}: {message}", file=sys.stderr)
        return 1 if failures else 0

    try:
        size = process_file(args.input, args.output, options)
    except (NoKeyColorFoundError, ValueError) as err:
        print(f"chroma_key_extract: {err}", file=sys.stderr)
        return 1
    print(f"chroma_key_extract: wrote {args.output} ({size[0]}x{size[1]}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
